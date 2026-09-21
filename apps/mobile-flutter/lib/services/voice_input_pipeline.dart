import 'package:crypto/crypto.dart';
import 'package:uuid/uuid.dart';

import '../models/domain_model.dart';
import '../models/model_command.dart';
import '../models/multimodal_proposal.dart';
import 'local_speech_recognizer.dart';
import 'voice_proposal_adapter.dart';

/// Orchestrates the agreed voice scenario (ADR-0005, Opción A;
/// multimodal-proposals-v1 §5.1): the on-device recognizer
/// ([LocalSpeechRecognizer], whisper.cpp on Android) produces the
/// transcript that replaces the previously injected text, and the
/// deterministic [VoiceProposalAdapter] converts it into a confirmable
/// [MultimodalProposal].
///
/// Recognition failures are never dropped: they are registered as an
/// auditable INVALID proposal whose `dryRunValidation.errors` carry the
/// §7 diagnostic code, so the review surface can show exactly why the
/// voice input could not be processed. The canonical model is never
/// mutated (MP-INV-1) and no network access occurs at any step
/// (§6.1 On-Device First — the pipeline works in airplane mode).
class VoiceProposalService {
  VoiceProposalService({
    required this._recognizer,
    VoiceProposalAdapter? adapter,
    DateTime Function()? clock,
  })  : _adapter = adapter ??
            VoiceProposalAdapter(
              clientPlatform: 'android',
              agentRole: 'android-whisper-local',
            ),
        _clock = clock ?? DateTime.now;

  final LocalSpeechRecognizer _recognizer;
  final VoiceProposalAdapter _adapter;
  final DateTime Function() _clock;

  static const Uuid _uuid = Uuid();

  /// Agent role reported on proposals built by this service (matches
  /// contract example §9.1).
  static const String agentRole = 'android-whisper-local';

  /// Runs the local ASR over [audio] and adapts the resulting transcript
  /// into a proposal for [model]. On success the proposal is exactly the
  /// confirmable artifact the adapter produces (VALID/WARNINGS →
  /// `awaiting_confirmation`, INVALID → `dry_run_validated`).
  ///
  /// On [SpeechRecognitionException] the returned artifact is a
  /// recognition-failure proposal (see [recognitionFailure]) that records
  /// the diagnostic instead of throwing.
  Future<MultimodalProposal> proposeFromAudio({
    required DomainModel model,
    required SpeechAudio audio,
    DateTime? capturedAt,
  }) async {
    final captured = (capturedAt ?? _clock()).toUtc();
    try {
      final transcript = await _recognizer.transcribe(audio);
      return _adapter.propose(
        model: model,
        transcript: transcript.text,
        mediaSha256: audio.sha256Hex,
        audioStartMs: transcript.startMs,
        audioEndMs: transcript.endMs,
        capturedAt: captured,
        modality: ProposalModality.voice,
      );
    } on SpeechRecognitionException catch (e) {
      return recognitionFailure(
        model: model,
        error: e,
        audio: audio,
        capturedAt: captured,
      );
    }
  }

  /// Builds the auditable INVALID proposal that registers a capture or
  /// recognition failure ([error]).
  ///
  /// The artifact keeps the `voice` modality and an `audio_segment`
  /// evidence holding the buffer hash (MP-INV-4/MP-INV-5); when the
  /// failure happened before any audio existed, the empty-input SHA-256
  /// is used. The canonical model is untouched and the deterministic gate
  /// refuses confirmation (MP-INV-2).
  MultimodalProposal recognitionFailure({
    required DomainModel model,
    required SpeechRecognitionException error,
    SpeechAudio? audio,
    DateTime? capturedAt,
  }) {
    final now = _clock().toUtc();
    return MultimodalProposal(
      proposalId: _uuid.v4(),
      modelId: model.id,
      targetModelVersion: model.version,
      createdAt: now,
      lifecycleState: ProposalLifecycleState.dryRunValidated,
      source: ProposalSource(
        modality: ProposalModality.voice,
        clientPlatform: 'android',
        agentRole: agentRole,
        capturedAt: (capturedAt ?? now).toUtc(),
      ),
      confidence: const ProposalConfidence(
        overall: 0.0,
        level: ConfidenceLevel.low,
      ),
      evidences: [
        ProposalEvidence(
          evidenceId: _uuid.v4(),
          type: EvidenceType.audioSegment,
          mediaSha256: audio?.sha256Hex ??
              sha256.convert(const <int>[]).toString(),
          payload: EvidencePayload(
            audioTimeRange: audio == null
                ? null
                : AudioTimeRange(startMs: 0, endMs: audio.durationMs),
            description: 'Captura de voz local sin transcripción usable: '
                '[${error.code}] ${error.message}',
          ),
        ),
      ],
      intent: ProposalIntent(
        summary: 'El reconocimiento de voz local falló: ${error.message}',
        rawPrompt: '',
      ),
      proposedCommands: const [],
      dryRunValidation: DryRunValidation(
        status: DryRunStatus.invalid,
        validatedAt: now,
        errors: [
          CommandDiagnostic(
            code: error.code,
            path: r'$.source',
            message: error.message,
            severity: DiagnosticSeverity.error,
          ),
        ],
      ),
    );
  }
}
