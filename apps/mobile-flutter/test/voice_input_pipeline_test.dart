import 'dart:convert';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_flutter/models/domain_model.dart';
import 'package:mobile_flutter/models/multimodal_proposal.dart';
import 'package:mobile_flutter/services/local_speech_recognizer.dart';
import 'package:mobile_flutter/services/voice_input_pipeline.dart';
import 'package:mobile_flutter/services/voice_proposal_adapter.dart';

/// ADR-0005 locución T1 del corpus de referencia.
const _locutionT1 =
    'Crear clase Cliente con id de tipo String obligatorio y email de tipo String opcional';

/// ADR-0005 locución T5: fuera de dominio → INTENT_UNRECOGNIZED.
const _locutionT5 = 'Hola buenos días por favor dibuja una casa con un árbol';

DomainModel _emptyTiendaModel() => DomainModel.fromJson({
      'contractVersion': '1',
      'id': 'model-tienda-01',
      'name': 'Tienda',
      'version': '1.0.0',
      'packages': [
        {'id': 'pkg-01', 'name': 'tienda'}
      ],
      'classes': [],
      'associations': [],
    });

/// Fully on-device recognizer fake: pure Dart, no platform channel, no
/// network — equivalent to the airplane-mode execution path.
class _FakeLocalRecognizer implements LocalSpeechRecognizer {
  SpeechTranscript? nextTranscript;
  SpeechRecognitionException? nextFailure;
  int transcribeCalls = 0;

  @override
  Future<bool> isAvailable() async => true;

  @override
  Future<SpeechTranscript> transcribe(SpeechAudio audio) async {
    transcribeCalls++;
    if (nextFailure != null) throw nextFailure!;
    final result = nextTranscript;
    if (result == null) {
      throw const SpeechRecognitionException(
        SpeechRecognitionErrorCodes.recognizerUnavailable,
        'fake sin resultado configurado',
      );
    }
    return result;
  }
}

/// Two seconds of PCM16 mono silence at 16 kHz.
SpeechAudio _audio() =>
    SpeechAudio(pcmBytes: Uint8List(kAsrSampleRateHz * 2 * 2));

void main() {
  late _FakeLocalRecognizer recognizer;
  late VoiceProposalService service;

  setUp(() {
    recognizer = _FakeLocalRecognizer();
    service = VoiceProposalService(recognizer: recognizer);
  });

  group('escenario de voz en modo avión (on-device, sin red)', () {
    test('locución T1 produce una propuesta confirmable con evidencia de '
        'audio local', () async {
      final audio = _audio();
      recognizer.nextTranscript = SpeechTranscript(
        text: _locutionT1,
        startMs: 0,
        endMs: audio.durationMs,
      );

      final proposal = await service.proposeFromAudio(
        model: _emptyTiendaModel(),
        audio: audio,
      );

      // La salida sigue siendo una propuesta confirmable (§3, §4).
      expect(proposal.lifecycleState,
          ProposalLifecycleState.awaitingConfirmation);
      expect(proposal.dryRunValidation!.status, DryRunStatus.valid);
      expect(proposal.proposedCommands, hasLength(3));
      expect(proposal.proposedCommands[0].type, 'CreateClass');
      expect(proposal.proposedCommands[0].payload['name'], 'Cliente');

      // Origen y evidencia del reconocimiento local (§3.1.1, §5.1.2).
      expect(proposal.source.modality, ProposalModality.voice);
      expect(proposal.source.clientPlatform, 'android');
      expect(proposal.source.agentRole, 'android-whisper-local');
      final evidence = proposal.evidences.single;
      expect(evidence.type, EvidenceType.audioSegment);
      expect(evidence.mediaSha256, audio.sha256Hex);
      expect(evidence.payload.textTranscript, _locutionT1);
      expect(evidence.payload.audioTimeRange!.startMs, 0);
      expect(evidence.payload.audioTimeRange!.endMs, audio.durationMs);
      expect(recognizer.transcribeCalls, 1);
    });

    test('la propuesta reconocida se confirma y muta el modelo solo tras '
        'la confirmación explícita', () async {
      final model = _emptyTiendaModel();
      recognizer.nextTranscript = const SpeechTranscript(
        text: _locutionT1,
        startMs: 0,
        endMs: 2000,
      );

      final proposal =
          await service.proposeFromAudio(model: model, audio: _audio());
      expect(model.classes, isEmpty); // dry-run nunca muta (MP-INV-2)

      final adapter = VoiceProposalAdapter();
      final outcome = adapter.confirm(
        proposal: proposal,
        model: model,
        confirmedBy: 'docente-evaluador',
      );

      expect(outcome.applied, isTrue);
      expect(model.classes.single.name, 'Cliente');
      expect(model.classes.single.attributes, hasLength(2));
      expect(outcome.proposal.lifecycleState,
          ProposalLifecycleState.confirmed);
    });

    test('locución fuera de dominio (T5) queda INVALID con '
        'INTENT_UNRECOGNIZED registrado', () async {
      recognizer.nextTranscript = const SpeechTranscript(
        text: _locutionT5,
        startMs: 0,
        endMs: 2000,
      );
      final model = _emptyTiendaModel();
      final before = jsonEncode(model.toJson());

      final proposal =
          await service.proposeFromAudio(model: model, audio: _audio());

      expect(proposal.proposedCommands, isEmpty);
      expect(proposal.dryRunValidation!.status, DryRunStatus.invalid);
      expect(
        proposal.dryRunValidation!.errors.map((e) => e.code),
        contains('INTENT_UNRECOGNIZED'),
      );
      expect(jsonEncode(model.toJson()), before);
    });
  });

  group('registro de errores de reconocimiento', () {
    test('motor no disponible → propuesta INVALID con '
        'SPEECH_RECOGNIZER_UNAVAILABLE auditable', () async {
      recognizer.nextFailure = const SpeechRecognitionException(
        SpeechRecognitionErrorCodes.recognizerUnavailable,
        'libwhisper_jni.so no enlazada o modelo ausente.',
      );
      final model = _emptyTiendaModel();
      final before = jsonEncode(model.toJson());
      final audio = _audio();

      final proposal =
          await service.proposeFromAudio(model: model, audio: audio);

      expect(proposal.lifecycleState,
          ProposalLifecycleState.dryRunValidated);
      expect(proposal.dryRunValidation!.status, DryRunStatus.invalid);
      expect(proposal.dryRunValidation!.errors, hasLength(1));
      expect(proposal.dryRunValidation!.errors.single.code,
          'SPEECH_RECOGNIZER_UNAVAILABLE');
      expect(proposal.confidence.level, ConfidenceLevel.low);
      // La evidencia conserva el hash del buffer capturado (MP-INV-4/5).
      expect(proposal.evidences.single.mediaSha256, audio.sha256Hex);
      expect(jsonEncode(model.toJson()), before);

      // La compuerta determinista rechaza la confirmación (MP-INV-2).
      final adapter = VoiceProposalAdapter();
      final outcome = adapter.confirm(
        proposal: proposal,
        model: model,
        confirmedBy: 'docente-evaluador',
      );
      expect(outcome.applied, isFalse);
      expect(
        outcome.errors.map((e) => e.code),
        contains('DETERMINISTIC_PRECONDITION_FAILED'),
      );
      expect(jsonEncode(model.toJson()), before);
    });

    test('audio ruidoso registra AUDIO_TOO_NOISY', () async {
      recognizer.nextFailure = const SpeechRecognitionException(
        SpeechRecognitionErrorCodes.audioTooNoisy,
        'SNR insuficiente para una transcripción inteligible.',
      );

      final proposal = await service.proposeFromAudio(
          model: _emptyTiendaModel(), audio: _audio());

      expect(proposal.dryRunValidation!.errors.single.code,
          'AUDIO_TOO_NOISY');
      expect(proposal.dryRunValidation!.status, DryRunStatus.invalid);
    });

    test('locución vacía registra MEDIA_PAYLOAD_EMPTY', () async {
      recognizer.nextFailure = const SpeechRecognitionException(
        SpeechRecognitionErrorCodes.mediaPayloadEmpty,
        'La captura está vacía.',
      );

      final proposal = await service.proposeFromAudio(
          model: _emptyTiendaModel(), audio: _audio());

      expect(proposal.dryRunValidation!.errors.single.code,
          'MEDIA_PAYLOAD_EMPTY');
    });

    test('timeout del motor local registra INFERENCE_TIMEOUT', () async {
      recognizer.nextFailure = const SpeechRecognitionException(
        SpeechRecognitionErrorCodes.inferenceTimeout,
        'El motor local no respondió en 10 s.',
      );

      final proposal = await service.proposeFromAudio(
          model: _emptyTiendaModel(), audio: _audio());

      expect(proposal.dryRunValidation!.errors.single.code,
          'INFERENCE_TIMEOUT');
    });

    test('fallo de captura sin audio registra el hash del buffer vacío '
        '(MP-INV-5)', () {
      final proposal = service.recognitionFailure(
        model: _emptyTiendaModel(),
        error: const SpeechRecognitionException(
          SpeechRecognitionErrorCodes.recordingPermissionDenied,
          'Permiso de micrófono denegado.',
        ),
      );

      expect(proposal.dryRunValidation!.errors.single.code,
          'RECORDING_PERMISSION_DENIED');
      // SHA-256 de entrada vacía — el mismo placeholder del contrato §9.1.
      expect(
        proposal.evidences.single.mediaSha256,
        sha256.convert(const <int>[]).toString(),
      );
      expect(proposal.evidences.single.payload.audioTimeRange, isNull);
    });
  });
}
