import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_flutter/services/local_speech_recognizer.dart';

/// One second of PCM16 mono silence at 16 kHz.
Uint8List _pcm({int seconds = 1}) =>
    Uint8List(kAsrSampleRateHz * seconds * 2);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;

  const recognizer = WhisperChannelRecognizer();
  const capture = MethodChannelAudioCapture();

  tearDown(() {
    messenger.setMockMethodCallHandler(kLocalAsrChannel, null);
  });

  group('SpeechAudio', () {
    test('duration and hash derive deterministically from the PCM buffer',
        () {
      final audio = SpeechAudio(pcmBytes: _pcm(seconds: 2));
      expect(audio.durationMs, 2000);
      expect(audio.sampleRate, kAsrSampleRateHz);
      expect(audio.sha256Hex, hasLength(64));
    });
  });

  group('WhisperChannelRecognizer', () {
    test('reports unavailable when no platform side is registered', () async {
      expect(await recognizer.isAvailable(), isFalse);
      await expectLater(
        recognizer.transcribe(SpeechAudio(pcmBytes: _pcm())),
        throwsA(
          isA<SpeechRecognitionException>().having(
            (e) => e.code,
            'code',
            SpeechRecognitionErrorCodes.recognizerUnavailable,
          ),
        ),
      );
    });

    test('rejects empty audio before touching the platform channel', () async {
      var channelCalls = 0;
      messenger.setMockMethodCallHandler(kLocalAsrChannel, (call) async {
        channelCalls++;
        return null;
      });

      await expectLater(
        recognizer.transcribe(SpeechAudio(pcmBytes: Uint8List(0))),
        throwsA(
          isA<SpeechRecognitionException>().having(
            (e) => e.code,
            'code',
            SpeechRecognitionErrorCodes.mediaPayloadEmpty,
          ),
        ),
      );
      expect(channelCalls, 0);
    });

    test('rejects utterances beyond the 45 s atomic-command limit', () async {
      var channelCalls = 0;
      messenger.setMockMethodCallHandler(kLocalAsrChannel, (call) async {
        channelCalls++;
        return null;
      });

      await expectLater(
        recognizer.transcribe(SpeechAudio(pcmBytes: _pcm(seconds: 46))),
        throwsA(
          isA<SpeechRecognitionException>().having(
            (e) => e.code,
            'code',
            SpeechRecognitionErrorCodes.audioDurationExceeded,
          ),
        ),
      );
      expect(channelCalls, 0);
    });

    test('maps a successful platform reply into a SpeechTranscript',
        () async {
      messenger.setMockMethodCallHandler(kLocalAsrChannel, (call) async {
        expect(call.method, 'transcribe');
        final args = call.arguments as Map<dynamic, dynamic>;
        expect(args['sampleRate'], kAsrSampleRateHz);
        expect(args['pcm'], isA<Uint8List>());
        return {
          'text': 'Crear clase Cliente',
          'startMs': 0,
          'endMs': 1000,
          'language': 'es',
        };
      });

      final transcript =
          await recognizer.transcribe(SpeechAudio(pcmBytes: _pcm()));

      expect(transcript.text, 'Crear clase Cliente');
      expect(transcript.startMs, 0);
      expect(transcript.endMs, 1000);
      expect(transcript.language, 'es');
    });

    test('empty platform transcription becomes INTENT_UNRECOGNIZED',
        () async {
      messenger.setMockMethodCallHandler(kLocalAsrChannel,
          (call) async => {'text': '   '});

      await expectLater(
        recognizer.transcribe(SpeechAudio(pcmBytes: _pcm())),
        throwsA(
          isA<SpeechRecognitionException>().having(
            (e) => e.code,
            'code',
            SpeechRecognitionErrorCodes.intentUnrecognized,
          ),
        ),
      );
    });

    test('catalog platform error codes propagate verbatim', () async {
      messenger.setMockMethodCallHandler(kLocalAsrChannel, (call) async {
        throw PlatformException(
          code: 'AUDIO_TOO_NOISY',
          message: 'SNR insuficiente.',
        );
      });

      await expectLater(
        recognizer.transcribe(SpeechAudio(pcmBytes: _pcm())),
        throwsA(
          isA<SpeechRecognitionException>()
              .having((e) => e.code, 'code',
                  SpeechRecognitionErrorCodes.audioTooNoisy)
              .having((e) => e.message, 'message', 'SNR insuficiente.'),
        ),
      );
    });

    test('unknown platform codes degrade to SPEECH_RECOGNIZER_UNAVAILABLE',
        () async {
      messenger.setMockMethodCallHandler(kLocalAsrChannel, (call) async {
        throw PlatformException(code: 'JNI_CRASH', message: 'boom');
      });

      await expectLater(
        recognizer.transcribe(SpeechAudio(pcmBytes: _pcm())),
        throwsA(
          isA<SpeechRecognitionException>().having(
            (e) => e.code,
            'code',
            SpeechRecognitionErrorCodes.recognizerUnavailable,
          ),
        ),
      );
    });
  });

  group('MethodChannelAudioCapture', () {
    test('start/stop returns the PCM captured by the platform side',
        () async {
      messenger.setMockMethodCallHandler(kLocalAsrChannel, (call) async {
        switch (call.method) {
          case 'startCapture':
            return null;
          case 'stopCapture':
            return {
              'pcm': _pcm(seconds: 2),
              'sampleRate': kAsrSampleRateHz,
              'durationMs': 2000,
            };
          default:
            return null;
        }
      });

      await capture.start();
      final audio = await capture.stop();

      expect(audio.pcmBytes, hasLength(kAsrSampleRateHz * 2 * 2));
      expect(audio.durationMs, 2000);
    });

    test('denied microphone permission maps to RECORDING_PERMISSION_DENIED',
        () async {
      messenger.setMockMethodCallHandler(kLocalAsrChannel, (call) async {
        if (call.method == 'startCapture') {
          throw PlatformException(
            code: 'RECORDING_PERMISSION_DENIED',
            message: 'El usuario no concedió el permiso de micrófono.',
          );
        }
        return null;
      });

      await expectLater(
        capture.start(),
        throwsA(
          isA<SpeechRecognitionException>().having(
            (e) => e.code,
            'code',
            SpeechRecognitionErrorCodes.recordingPermissionDenied,
          ),
        ),
      );
    });

    test('missing platform side reports SPEECH_RECOGNIZER_UNAVAILABLE',
        () async {
      await expectLater(
        capture.start(),
        throwsA(
          isA<SpeechRecognitionException>().having(
            (e) => e.code,
            'code',
            SpeechRecognitionErrorCodes.recognizerUnavailable,
          ),
        ),
      );
    });
  });
}
