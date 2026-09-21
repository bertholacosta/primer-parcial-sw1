import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:uuid/uuid.dart';

import '../models/domain_model.dart';
import '../models/model_command.dart';
import '../models/multimodal_proposal.dart';
import 'local_interpreter.dart';
import 'local_speech_recognizer.dart';
import 'voice_proposal_adapter.dart';

/// Orchestrates the agreed local interpretation scenario (ADR-0005,
/// Opción A; multimodal-proposals-v1 §5.1): the on-device recognizer
/// ([LocalSpeechRecognizer], whisper.cpp on Android) produces the
/// transcript, the on-device interpreter ([LocalInterpreter],
/// llama.cpp/Qwen2.5) converts it into structured model-commands-v1
/// commands, and the deterministic [VoiceProposalAdapter] assembles and
/// dry-runs a confirmable [MultimodalProposal].
///
/// The SLM stage is strictly sequential after ASR (ADR-0005 memory
/// policy) and strictly optional at runtime: when the native engine or
/// its weights are absent the pipeline degrades to the deterministic
/// transcript parser, so the app stays usable in emulators and CI.
///
/// Recognition and interpretation failures are never dropped: they are
/// registered as auditable INVALID proposals whose
/// `dryRunValidation.errors` carry the §7 diagnostic code, so the review
/// surface can show exactly why the input could not be processed. The
/// canonical model is never mutated (MP-INV-1) and no network access
/// occurs at any step (§6.1 On-Device First — the pipeline works in
/// airplane mode).
class VoiceProposalService {
  VoiceProposalService({
    required this._recognizer,
    this._interpreter,
    VoiceProposalAdapter? adapter,
    DateTime Function()? clock,
  })  : _adapter = adapter ??
            VoiceProposalAdapter(
              clientPlatform: 'android',
              agentRole: 'android-whisper-local',
            ),
        _clock = clock ?? DateTime.now;

  final LocalSpeechRecognizer _recognizer;
  final LocalInterpreter? _interpreter;
  final VoiceProposalAdapter _adapter;
  final DateTime Function() _clock;

  static const Uuid _uuid = Uuid();

  /// Agent role reported on proposals built by this service (matches
  /// contract example §9.1).
  static const String agentRole = 'android-whisper-local';

  /// Agent role reported on proposals whose commands were inferred by the
  /// on-device SLM (llama.cpp running Qwen2.5-1.5B-Instruct per ADR-0005).
  static const String slmAgentRole = 'android-qwen2.5-slm-local';

  /// Runs the local ASR over [audio] and then the local interpretation
  /// stage (SLM when available, deterministic parser otherwise), adapting
  /// the outcome into a proposal for [model]. On success the proposal is
  /// exactly the confirmable artifact the adapter produces
  /// (VALID/WARNINGS → `awaiting_confirmation`, INVALID →
  /// `dry_run_validated`).
  ///
  /// On [SpeechRecognitionException] or [InterpretationException] the
  /// returned artifact is a failure proposal (see [recognitionFailure]
  /// and [interpretationFailure]) that records the diagnostic instead of
  /// throwing.
  Future<MultimodalProposal> proposeFromAudio({
    required DomainModel model,
    required SpeechAudio audio,
    DateTime? capturedAt,
  }) async {
    final captured = (capturedAt ?? _clock()).toUtc();
    final SpeechTranscript transcript;
    try {
      transcript = await _recognizer.transcribe(audio);
    } on SpeechRecognitionException catch (e) {
      return recognitionFailure(
        model: model,
        error: e,
        audio: audio,
        capturedAt: captured,
      );
    }

    final interpretation = await _interpretSafely(model, transcript.text);
    if (interpretation is InterpretationException) {
      return interpretationFailure(
        model: model,
        error: interpretation,
        audio: audio,
        transcript: transcript.text,
        capturedAt: captured,
      );
    }
    if (interpretation is InterpretationResult) {
      return _adapter.proposeFromInterpretation(
        model: model,
        transcript: transcript.text,
        interpretation: interpretation,
        mediaSha256: audio.sha256Hex,
        audioStartMs: transcript.startMs,
        audioEndMs: transcript.endMs,
        capturedAt: captured,
        modality: ProposalModality.voice,
        agentRole: slmAgentRole,
      );
    }
    return _adapter.propose(
      model: model,
      transcript: transcript.text,
      mediaSha256: audio.sha256Hex,
      audioStartMs: transcript.startMs,
      audioEndMs: transcript.endMs,
      capturedAt: captured,
      modality: ProposalModality.voice,
    );
  }

  /// Interprets an already available [transcript] (e.g. a typed prompt)
  /// through the same local pipeline used for voice: SLM when available,
  /// deterministic adapter as fallback. [modality] declares the real
  /// input channel (§3.1.1); use [ProposalModality.textPrompt] for text
  /// entered directly by the user.
  Future<MultimodalProposal> proposeFromTranscript({
    required DomainModel model,
    required String transcript,
    ProposalModality modality = ProposalModality.textPrompt,
    DateTime? capturedAt,
  }) async {
    final captured = (capturedAt ?? _clock()).toUtc();
    final interpretation = await _interpretSafely(model, transcript);
    if (interpretation is InterpretationException) {
      return interpretationFailure(
        model: model,
        error: interpretation,
        transcript: transcript,
        capturedAt: captured,
        modality: modality,
      );
    }
    if (interpretation is InterpretationResult) {
      return _adapter.proposeFromInterpretation(
        model: model,
        transcript: transcript,
        interpretation: interpretation,
        capturedAt: captured,
        modality: modality,
        agentRole: slmAgentRole,
      );
    }
    return _adapter.propose(
      model: model,
      transcript: transcript,
      capturedAt: captured,
      modality: modality,
    );
  }

  /// Invokes the on-device interpreter honouring the sequential
  /// ASR → SLM memory policy of ADR-0005 (it runs only after the ASR
  /// context was released). Returns `null` when no interpreter is wired
  /// or the engine reports itself unavailable — the caller then falls
  /// back to the deterministic parser — and the
  /// [InterpretationException] itself when the engine failed.
  Future<Object?> _interpretSafely(DomainModel model, String input) async {
    final interpreter = _interpreter;
    if (interpreter == null) return null;
    try {
      if (!await interpreter.isAvailable()) return null;
      return await interpreter.interpret(
        InterpretationRequest(transcript: input, model: model),
      );
    } on InterpretationException catch (e) {
      return e;
    } on Object catch (e) {
      return InterpretationException(
        LocalInterpretationErrorCodes.slmUnavailable,
        'Error inesperado del intérprete local: $e',
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

  /// Builds the auditable INVALID proposal that registers a failure of
  /// the on-device interpretation stage ([error]).
  ///
  /// The transcript produced by the ASR (or typed by the user) is
  /// preserved as evidence together with the media hash, so reviewers can
  /// verify exactly what the SLM received before it failed. The canonical
  /// model is untouched and the deterministic gate refuses confirmation
  /// (MP-INV-2).
  MultimodalProposal interpretationFailure({
    required DomainModel model,
    required InterpretationException error,
    String? transcript,
    SpeechAudio? audio,
    ProposalModality modality = ProposalModality.voice,
    DateTime? capturedAt,
  }) {
    final now = _clock().toUtc();
    final isVoice = modality == ProposalModality.voice;
    return MultimodalProposal(
      proposalId: _uuid.v4(),
      modelId: model.id,
      targetModelVersion: model.version,
      createdAt: now,
      lifecycleState: ProposalLifecycleState.dryRunValidated,
      source: ProposalSource(
        modality: modality,
        clientPlatform: 'android',
        agentRole: slmAgentRole,
        capturedAt: (capturedAt ?? now).toUtc(),
      ),
      confidence: const ProposalConfidence(
        overall: 0.0,
        level: ConfidenceLevel.low,
      ),
      evidences: [
        ProposalEvidence(
          evidenceId: _uuid.v4(),
          type: isVoice ? EvidenceType.audioSegment : EvidenceType.textTranscript,
          mediaSha256: audio?.sha256Hex ??
              sha256.convert(utf8.encode(transcript ?? '')).toString(),
          payload: EvidencePayload(
            textTranscript: transcript,
            audioTimeRange: audio == null
                ? null
                : AudioTimeRange(startMs: 0, endMs: audio.durationMs),
            description: 'Entrada local sin interpretación usable: '
                '[${error.code}] ${error.message}',
          ),
        ),
      ],
      intent: ProposalIntent(
        summary:
            'La interpretación local de IA falló: ${error.message}',
        rawPrompt: transcript ?? '',
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
