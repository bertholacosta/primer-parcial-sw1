import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_flutter/models/multimodal_proposal.dart';
import 'package:mobile_flutter/services/local_speech_recognizer.dart';
import 'package:mobile_flutter/state/onboarding_state.dart';
import 'package:mobile_flutter/widgets/guided_onboarding.dart';

const _locutionT1 =
    'Crear clase Cliente con id de tipo String obligatorio y email de tipo String opcional';

/// On-device recognizer fake: pure Dart, no platform channel, no network.
class _FakeRecognizer implements LocalSpeechRecognizer {
  SpeechTranscript? nextTranscript;
  SpeechRecognitionException? nextFailure;

  @override
  Future<bool> isAvailable() async => true;

  @override
  Future<SpeechTranscript> transcribe(SpeechAudio audio) async {
    if (nextFailure != null) throw nextFailure!;
    return nextTranscript ??
        SpeechTranscript(
          text: _locutionT1,
          startMs: 0,
          endMs: audio.durationMs,
        );
  }
}

/// Capture fake returning a fixed PCM buffer (2 s of silence at 16 kHz).
class _FakeCapture implements AudioCaptureSource {
  SpeechRecognitionException? startFailure;
  SpeechRecognitionException? stopFailure;
  bool recording = false;

  static SpeechAudio fixedAudio() =>
      SpeechAudio(pcmBytes: Uint8List(kAsrSampleRateHz * 2 * 2));

  @override
  Future<void> start() async {
    if (startFailure != null) throw startFailure!;
    recording = true;
  }

  @override
  Future<SpeechAudio> stop() async {
    recording = false;
    if (stopFailure != null) throw stopFailure!;
    return fixedAudio();
  }

  @override
  Future<void> cancel() async {
    recording = false;
  }
}

ProviderContainer _container({_FakeRecognizer? recognizer, _FakeCapture? capture}) {
  final container = ProviderContainer(overrides: [
    localSpeechRecognizerProvider
        .overrideWithValue(recognizer ?? _FakeRecognizer()),
    audioCaptureProvider.overrideWithValue(capture ?? _FakeCapture()),
  ]);
  addTearDown(container.dispose);
  return container;
}

void main() {
  group('OnboardingNotifier — escenario de voz (modo avión)', () {
    test('push-to-talk completo produce una propuesta de voz confirmable',
        () async {
      final container = _container();
      final notifier = container.read(onboardingProvider.notifier);

      await notifier.startVoiceCapture();
      expect(container.read(onboardingProvider), isA<OnboardingListening>());

      await notifier.stopVoiceCapture();

      final state = container.read(onboardingProvider);
      expect(state, isA<OnboardingProposalReady>());
      final ready = state as OnboardingProposalReady;
      expect(ready.proposal.source.modality, ProposalModality.voice);
      expect(ready.proposal.source.agentRole, 'android-whisper-local');
      expect(ready.proposal.dryRunValidation!.status, DryRunStatus.valid);
      expect(ready.proposal.evidences.single.type, EvidenceType.audioSegment);
      expect(ready.proposal.evidences.single.payload.audioTimeRange,
          isNotNull);
      expect(ready.canConfirm, isTrue);
      // Nada mutó antes de la confirmación (MP-INV-3).
      expect(notifier.domainModel.classes, isEmpty);
    });

    test('confirmar la propuesta de voz aplica los comandos al modelo',
        () async {
      final container = _container();
      final notifier = container.read(onboardingProvider.notifier);

      await notifier.startVoiceCapture();
      await notifier.stopVoiceCapture();
      notifier.confirm(confirmedBy: 'tester');

      final state = container.read(onboardingProvider);
      expect(state, isA<OnboardingResolved>());
      expect((state as OnboardingResolved).applied, isTrue);
      expect(notifier.domainModel.classes.single.name, 'Cliente');
      expect(notifier.domainModel.classes.single.attributes, hasLength(2));
    });

    test('error de reconocimiento se registra en la propuesta y bloquea '
        'la confirmación sin tocar el modelo', () async {
      final recognizer = _FakeRecognizer()
        ..nextFailure = const SpeechRecognitionException(
          SpeechRecognitionErrorCodes.recognizerUnavailable,
          'libwhisper_jni.so no enlazada.',
        );
      final container = _container(recognizer: recognizer);
      final notifier = container.read(onboardingProvider.notifier);
      final before = jsonEncode(notifier.domainModel.toJson());

      await notifier.startVoiceCapture();
      await notifier.stopVoiceCapture();

      final state = container.read(onboardingProvider);
      expect(state, isA<OnboardingProposalReady>());
      final ready = state as OnboardingProposalReady;
      expect(ready.isInvalid, isTrue);
      expect(ready.canConfirm, isFalse);
      expect(
        ready.proposal.dryRunValidation!.errors.map((e) => e.code),
        contains('SPEECH_RECOGNIZER_UNAVAILABLE'),
      );
      expect(jsonEncode(notifier.domainModel.toJson()), before);
    });

    test('permiso de micrófono denegado se registra como propuesta '
        'INVALID auditable', () async {
      final capture = _FakeCapture()
        ..startFailure = const SpeechRecognitionException(
          SpeechRecognitionErrorCodes.recordingPermissionDenied,
          'Permiso de micrófono denegado.',
        );
      final container = _container(capture: capture);
      final notifier = container.read(onboardingProvider.notifier);

      await notifier.startVoiceCapture();

      final state = container.read(onboardingProvider);
      expect(state, isA<OnboardingProposalReady>());
      final ready = state as OnboardingProposalReady;
      expect(ready.proposal.dryRunValidation!.status, DryRunStatus.invalid);
      expect(
        ready.proposal.dryRunValidation!.errors.map((e) => e.code),
        contains('RECORDING_PERMISSION_DENIED'),
      );
      expect(ready.proposal.source.modality, ProposalModality.voice);
    });

    test('cancelar durante la escucha vuelve al paso de intención',
        () async {
      final capture = _FakeCapture();
      final container = _container(capture: capture);
      final notifier = container.read(onboardingProvider.notifier);

      await notifier.startVoiceCapture();
      await notifier.cancelVoiceCapture();

      expect(container.read(onboardingProvider), isA<OnboardingIdle>());
      expect(capture.recording, isFalse);
    });
  });

  group('GuidedOnboardingScreen — push-to-talk', () {
    Future<ProviderContainer> pumpScreen(
      WidgetTester tester, {
      _FakeRecognizer? recognizer,
      _FakeCapture? capture,
    }) async {
      final container = ProviderContainer(overrides: [
        localSpeechRecognizerProvider
            .overrideWithValue(recognizer ?? _FakeRecognizer()),
        audioCaptureProvider.overrideWithValue(capture ?? _FakeCapture()),
      ]);
      addTearDown(container.dispose);
      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: const MaterialApp(home: GuidedOnboardingScreen()),
        ),
      );
      await tester.pumpAndSettle();
      return container;
    }

    testWidgets('mantener el micrófono y soltar genera la propuesta de voz',
        (tester) async {
      final container = await pumpScreen(tester);

      final gesture = await tester
          .press(find.byKey(const Key('onboarding_voice_record')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('onboarding_step_listening')),
          findsOneWidget);

      await gesture.up();
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('onboarding_step_review')), findsOneWidget);
      expect(find.byKey(const Key('onboarding_dryrun_valid')),
          findsOneWidget);
      expect(find.text('voice'), findsOneWidget);

      await tester.tap(find.byKey(const Key('onboarding_confirm')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('onboarding_result_confirmed')),
          findsOneWidget);
      final notifier = container.read(onboardingProvider.notifier);
      expect(notifier.domainModel.classes.single.name, 'Cliente');
    });

    testWidgets('fallo de reconocimiento muestra el diagnóstico y '
        'deshabilita confirmar', (tester) async {
      final recognizer = _FakeRecognizer()
        ..nextFailure = const SpeechRecognitionException(
          SpeechRecognitionErrorCodes.audioTooNoisy,
          'SNR insuficiente.',
        );
      await pumpScreen(tester, recognizer: recognizer);

      final gesture = await tester
          .press(find.byKey(const Key('onboarding_voice_record')));
      await tester.pumpAndSettle();
      await gesture.up();
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('onboarding_dryrun_invalid')),
          findsOneWidget);
      expect(find.textContaining('AUDIO_TOO_NOISY'), findsWidgets);
      final confirmButton = tester
          .widget<ElevatedButton>(find.byKey(const Key('onboarding_confirm')));
      expect(confirmButton.onPressed, isNull);
    });
  });
}
