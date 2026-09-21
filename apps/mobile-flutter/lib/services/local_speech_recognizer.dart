import 'dart:async';

import 'package:crypto/crypto.dart';
import 'package:flutter/services.dart';

/// Canonical capture format for the on-device ASR pipeline (ADR-0005):
/// whisper.cpp consumes PCM 16 kHz mono 16-bit samples.
const int kAsrSampleRateHz = 16000;

/// Maximum utterance length for an atomic voice command
/// (multimodal-proposals-v1 §7.1 `AUDIO_DURATION_EXCEEDED`: 45 s).
const int kMaxUtteranceMs = 45000;

/// Local inference timeout for the ASR stage
/// (multimodal-proposals-v1 §7.2 `INFERENCE_TIMEOUT`: 10 s on-device).
const Duration kAsrTimeout = Duration(seconds: 10);

/// MethodChannel shared with the Android local-ASR bridge
/// (`LocalAsrMethodHandler`, package `com.example.mobile_flutter`). The
/// bridge captures PCM audio with `AudioRecord` and transcribes it with
/// whisper.cpp (`libwhisper_jni.so`); everything runs on-device, so the
/// agreed voice scenario works in airplane mode.
const MethodChannel kLocalAsrChannel = MethodChannel('case_mobile/local_asr');

/// Diagnostic codes emitted by the capture/recognition stage.
///
/// Codes defined by the multimodal-proposals-v1 §7 catalog are reused
/// verbatim; the `SPEECH_*`/`RECORDING_*` constants extend the §7.1/§7.2
/// families for capture-time conditions the catalog does not enumerate
/// (engine not linked, denied microphone permission).
abstract final class SpeechRecognitionErrorCodes {
  static const String mediaPayloadEmpty = 'MEDIA_PAYLOAD_EMPTY';
  static const String audioDurationExceeded = 'AUDIO_DURATION_EXCEEDED';
  static const String audioTooNoisy = 'AUDIO_TOO_NOISY';
  static const String inferenceTimeout = 'INFERENCE_TIMEOUT';
  static const String intentUnrecognized = 'INTENT_UNRECOGNIZED';
  static const String recognizerUnavailable = 'SPEECH_RECOGNIZER_UNAVAILABLE';
  static const String recordingPermissionDenied =
      'RECORDING_PERMISSION_DENIED';
  static const String recordingFailed = 'RECORDING_FAILED';
}

/// Captured PCM audio destined for the on-device recognizer.
///
/// The raw buffer is kept only in memory and is never persisted
/// (MP-INV-5): only [sha256Hex] survives inside the proposal as auditable
/// evidence.
class SpeechAudio {
  SpeechAudio({required this.pcmBytes, this.sampleRate = kAsrSampleRateHz});

  /// PCM 16-bit little-endian mono samples.
  final Uint8List pcmBytes;

  /// Capture sample rate in Hz ([kAsrSampleRateHz] for the ASR pipeline).
  final int sampleRate;

  int get sampleCount => pcmBytes.length ~/ 2;

  int get durationMs => sampleCount * 1000 ~/ sampleRate;

  /// SHA-256 of the raw buffer (§5.1.2 `mediaSha256`).
  String get sha256Hex => sha256.convert(pcmBytes).toString();
}

/// Transcript produced by the local recognizer for one utterance.
class SpeechTranscript {
  const SpeechTranscript({
    required this.text,
    required this.startMs,
    required this.endMs,
    this.language = 'es',
    this.confidence,
  });

  /// Raw transcript text handed to the proposal adapter.
  final String text;

  /// Temporal range of the utterance (§5.1.2 `audioTimeRange`).
  final int startMs;
  final int endMs;

  /// Detected/forced transcription language.
  final String language;

  /// Optional ASR confidence reported by the engine.
  final double? confidence;
}

/// Failure of the capture or on-device recognition stage. [code] is a
/// §7 catalog code or a `SPEECH_*`/`RECORDING_*` extension; it is copied
/// verbatim into the proposal diagnostics so recognition errors remain
/// auditable.
class SpeechRecognitionException implements Exception {
  const SpeechRecognitionException(this.code, this.message, [this.details]);

  final String code;
  final String message;
  final Object? details;

  @override
  String toString() => '[$code] $message';
}

/// On-device speech recognizer (ADR-0005, Opción A). Implementations must
/// never perform network access.
abstract class LocalSpeechRecognizer {
  /// Whether the on-device engine is ready (native library loaded and
  /// model weights present in app-private storage).
  Future<bool> isAvailable();

  /// Transcribes [audio] locally and returns the raw transcript with its
  /// utterance time range.
  ///
  /// Throws [SpeechRecognitionException] on any capture/inference
  /// failure; the code is always a catalog-compatible diagnostic.
  Future<SpeechTranscript> transcribe(SpeechAudio audio);
}

/// whisper.cpp recognizer bridged to Android through [kLocalAsrChannel].
///
/// Dart-side guards run before the channel hop so empty or oversized
/// audio fails deterministically even when the platform side is absent.
class WhisperChannelRecognizer implements LocalSpeechRecognizer {
  const WhisperChannelRecognizer();

  @override
  Future<bool> isAvailable() async {
    try {
      return await kLocalAsrChannel.invokeMethod<bool>('isAvailable') ??
          false;
    } on MissingPluginException {
      return false;
    } on PlatformException {
      return false;
    }
  }

  @override
  Future<SpeechTranscript> transcribe(SpeechAudio audio) async {
    if (audio.pcmBytes.isEmpty) {
      throw const SpeechRecognitionException(
        SpeechRecognitionErrorCodes.mediaPayloadEmpty,
        'La captura de audio está vacía; no hay señal que transcribir.',
      );
    }
    if (audio.durationMs > kMaxUtteranceMs) {
      throw SpeechRecognitionException(
        SpeechRecognitionErrorCodes.audioDurationExceeded,
        'La locución de ${audio.durationMs} ms supera el máximo de '
            '$kMaxUtteranceMs ms por comando atómico.',
      );
    }

    final Map<dynamic, dynamic>? raw;
    try {
      raw = await kLocalAsrChannel
          .invokeMethod<Map<dynamic, dynamic>>('transcribe', {
        'pcm': audio.pcmBytes,
        'sampleRate': audio.sampleRate,
      }).timeout(kAsrTimeout);
    } on TimeoutException {
      throw const SpeechRecognitionException(
        SpeechRecognitionErrorCodes.inferenceTimeout,
        'El motor local de voz no respondió dentro del límite de 10 s.',
      );
    } on MissingPluginException {
      throw const SpeechRecognitionException(
        SpeechRecognitionErrorCodes.recognizerUnavailable,
        'El motor nativo de reconocimiento no está integrado en esta '
            'compilación.',
      );
    } on PlatformException catch (e) {
      throw SpeechRecognitionException(
        _mapPlatformCode(e.code),
        e.message ?? 'Error del reconocedor local.',
        e.details,
      );
    }

    final text = (raw?['text'] as String? ?? '').trim();
    if (text.isEmpty) {
      throw const SpeechRecognitionException(
        SpeechRecognitionErrorCodes.intentUnrecognized,
        'El reconocedor no produjo texto para la locución capturada.',
      );
    }
    return SpeechTranscript(
      text: text,
      startMs: (raw?['startMs'] as num?)?.toInt() ?? 0,
      endMs: (raw?['endMs'] as num?)?.toInt() ?? audio.durationMs,
      language: raw?['language'] as String? ?? 'es',
      confidence: (raw?['confidence'] as num?)?.toDouble(),
    );
  }

  static String _mapPlatformCode(String code) => switch (code) {
        'MEDIA_PAYLOAD_EMPTY' =>
          SpeechRecognitionErrorCodes.mediaPayloadEmpty,
        'AUDIO_DURATION_EXCEEDED' =>
          SpeechRecognitionErrorCodes.audioDurationExceeded,
        'AUDIO_TOO_NOISY' => SpeechRecognitionErrorCodes.audioTooNoisy,
        'INFERENCE_TIMEOUT' => SpeechRecognitionErrorCodes.inferenceTimeout,
        'INTENT_UNRECOGNIZED' =>
          SpeechRecognitionErrorCodes.intentUnrecognized,
        _ => SpeechRecognitionErrorCodes.recognizerUnavailable,
      };
}

/// Push-to-talk PCM capture source (multimodal-proposals-v1 §5.1.1
/// steps 1–2). `start()` begins recording; `stop()` returns the captured
/// audio; `cancel()` discards it.
abstract class AudioCaptureSource {
  Future<void> start();
  Future<SpeechAudio> stop();
  Future<void> cancel();
}

/// Android capture over [kLocalAsrChannel]: the Kotlin side records PCM
/// 16 kHz mono with `AudioRecord` and returns the raw buffer on
/// `stopCapture`.
class MethodChannelAudioCapture implements AudioCaptureSource {
  const MethodChannelAudioCapture();

  @override
  Future<void> start() async {
    try {
      await kLocalAsrChannel.invokeMethod<void>('startCapture');
    } on PlatformException catch (e) {
      throw SpeechRecognitionException(
        e.code == SpeechRecognitionErrorCodes.recordingPermissionDenied
            ? SpeechRecognitionErrorCodes.recordingPermissionDenied
            : SpeechRecognitionErrorCodes.recordingFailed,
        e.message ?? 'No se pudo iniciar la captura de micrófono.',
        e.details,
      );
    } on MissingPluginException {
      throw const SpeechRecognitionException(
        SpeechRecognitionErrorCodes.recognizerUnavailable,
        'La captura nativa no está integrada en esta compilación.',
      );
    }
  }

  @override
  Future<SpeechAudio> stop() async {
    final Map<dynamic, dynamic>? raw;
    try {
      raw = await kLocalAsrChannel
          .invokeMethod<Map<dynamic, dynamic>>('stopCapture');
    } on PlatformException catch (e) {
      throw SpeechRecognitionException(
        SpeechRecognitionErrorCodes.recordingFailed,
        e.message ?? 'No se pudo obtener la captura de micrófono.',
        e.details,
      );
    } on MissingPluginException {
      throw const SpeechRecognitionException(
        SpeechRecognitionErrorCodes.recognizerUnavailable,
        'La captura nativa no está integrada en esta compilación.',
      );
    }
    return SpeechAudio(
      pcmBytes: raw?['pcm'] as Uint8List? ?? Uint8List(0),
      sampleRate:
          (raw?['sampleRate'] as num?)?.toInt() ?? kAsrSampleRateHz,
    );
  }

  @override
  Future<void> cancel() async {
    try {
      await kLocalAsrChannel.invokeMethod<void>('cancelCapture');
    } on PlatformException {
      // Best-effort release of the native recorder.
    } on MissingPluginException {
      // No platform side to release.
    }
  }
}
