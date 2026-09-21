/// Immutable, auditable proposal artifact of the multimodal-proposals-v1
/// contract (§3). A proposal encapsulates probabilistic inference output as
/// ordered model-commands-v1 commands plus evidence, confidence and the
/// deterministic dry-run result, and only mutates the model after explicit
/// user confirmation (MP-INV-3, MP-INV-6).
library;

import 'model_command.dart';

/// Lifecycle states of a proposal (multimodal-proposals-v1 §4.1).
enum ProposalLifecycleState {
  proposed('proposed'),
  dryRunValidated('dry_run_validated'),
  awaitingConfirmation('awaiting_confirmation'),
  confirmed('confirmed'),
  partiallyConfirmed('partially_confirmed'),
  rejected('rejected'),
  expired('expired');

  const ProposalLifecycleState(this.wireName);
  final String wireName;
}

/// Input modality of the proposal (§3.1.1).
enum ProposalModality {
  voice('voice'),
  image('image'),
  multimodal('multimodal'),
  textPrompt('text_prompt');

  const ProposalModality(this.wireName);
  final String wireName;
}

/// Qualitative confidence level (§3.1.2).
enum ConfidenceLevel {
  high('HIGH'),
  medium('MEDIUM'),
  low('LOW');

  const ConfidenceLevel(this.wireName);
  final String wireName;
}

/// Auditable evidence type (§3.1.3).
enum EvidenceType {
  audioSegment('audio_segment'),
  boundingBox('bounding_box'),
  textTranscript('text_transcript'),
  inferenceRationale('inference_rationale');

  const EvidenceType(this.wireName);
  final String wireName;
}

/// Dry-run validation status (§3.1.5).
enum DryRunStatus {
  valid('VALID'),
  invalid('INVALID'),
  warnings('WARNINGS');

  const DryRunStatus(this.wireName);
  final String wireName;
}

/// Resolution action of a proposal (§8).
enum ResolutionAction {
  confirmAll('confirm_all'),
  confirmSelection('confirm_selection'),
  reject('reject'),
  expire('expire');

  const ResolutionAction(this.wireName);
  final String wireName;
}

/// Origin of the captured input (§3.1.1).
class ProposalSource {
  final ProposalModality modality;
  final String clientPlatform;
  final String agentRole;
  final DateTime capturedAt;

  const ProposalSource({
    required this.modality,
    required this.clientPlatform,
    required this.agentRole,
    required this.capturedAt,
  });

  Map<String, dynamic> toJson() => {
        'modality': modality.wireName,
        'clientPlatform': clientPlatform,
        'agentRole': agentRole,
        'capturedAt': capturedAt.toUtc().toIso8601String(),
      };
}

/// Per-command confidence detail (§3.1.2 `breakdown`).
class ConfidenceBreakdown {
  final int commandIndex;
  final double score;
  final Map<String, double> fieldScores;

  const ConfidenceBreakdown({
    required this.commandIndex,
    required this.score,
    this.fieldScores = const {},
  });

  Map<String, dynamic> toJson() => {
        'commandIndex': commandIndex,
        'score': score,
        'fieldScores': fieldScores,
      };
}

/// Aggregate confidence of the proposal (§3.1.2).
class ProposalConfidence {
  final double overall;
  final ConfidenceLevel level;
  final List<ConfidenceBreakdown> breakdown;

  const ProposalConfidence({
    required this.overall,
    required this.level,
    this.breakdown = const [],
  });

  Map<String, dynamic> toJson() => {
        'overall': overall,
        'level': level.wireName,
        'breakdown': breakdown.map((b) => b.toJson()).toList(),
      };
}

/// Temporal range of a voice segment in milliseconds (§3.1.3, §5.1.2).
class AudioTimeRange {
  final int startMs;
  final int endMs;

  const AudioTimeRange({required this.startMs, required this.endMs});

  Map<String, dynamic> toJson() => {'startMs': startMs, 'endMs': endMs};
}

/// Normalized bounding box `[0.0, 1.0]` over the source image (§3.1.3).
class BoundingBox {
  final double ymin;
  final double xmin;
  final double ymax;
  final double xmax;

  const BoundingBox({
    required this.ymin,
    required this.xmin,
    required this.ymax,
    required this.xmax,
  });

  Map<String, dynamic> toJson() =>
      {'ymin': ymin, 'xmin': xmin, 'ymax': ymax, 'xmax': xmax};
}

/// Payload attached to an evidence item (§3.1.3).
class EvidencePayload {
  final String? textTranscript;
  final AudioTimeRange? audioTimeRange;
  final BoundingBox? boundingBox;
  final String? description;

  const EvidencePayload({
    this.textTranscript,
    this.audioTimeRange,
    this.boundingBox,
    this.description,
  });

  Map<String, dynamic> toJson() => {
        if (textTranscript != null) 'textTranscript': textTranscript,
        if (audioTimeRange != null) 'audioTimeRange': audioTimeRange!.toJson(),
        if (boundingBox != null) 'boundingBox': boundingBox!.toJson(),
        if (description != null) 'description': description,
      };
}

/// Auditable evidence backing the proposal (§3.1.3, MP-INV-4, MP-INV-5).
class ProposalEvidence {
  final String evidenceId;
  final EvidenceType type;
  final String mediaSha256;
  final EvidencePayload payload;

  const ProposalEvidence({
    required this.evidenceId,
    required this.type,
    required this.mediaSha256,
    required this.payload,
  });

  Map<String, dynamic> toJson() => {
        'evidenceId': evidenceId,
        'type': type.wireName,
        'mediaSha256': mediaSha256,
        'payload': payload.toJson(),
      };
}

/// Natural-language intent detected by the extractor (§3).
class ProposalIntent {
  final String summary;
  final String rawPrompt;

  const ProposalIntent({required this.summary, required this.rawPrompt});

  Map<String, dynamic> toJson() =>
      {'summary': summary, 'rawPrompt': rawPrompt};
}

/// Deterministic dry-run result over `proposedCommands` (§3.1.5).
class DryRunValidation {
  final DryRunStatus status;
  final DateTime validatedAt;
  final List<CommandDiagnostic> errors;
  final List<CommandDiagnostic> warnings;

  const DryRunValidation({
    required this.status,
    required this.validatedAt,
    this.errors = const [],
    this.warnings = const [],
  });

  Map<String, dynamic> toJson() => {
        'validationStatus': status.wireName,
        'validatedAt': validatedAt.toUtc().toIso8601String(),
        'errors': errors.map((e) => e.toJson()).toList(),
        'warnings': warnings.map((w) => w.toJson()).toList(),
      };
}

/// Confirmation/rejection record of the proposal lifecycle (§3, §8).
class ProposalResolution {
  final DateTime resolvedAt;
  final String resolvedBy;
  final ResolutionAction action;
  final List<String> acceptedCommandIds;
  final List<String> rejectedCommandIds;
  final String? rejectionReason;

  const ProposalResolution({
    required this.resolvedAt,
    required this.resolvedBy,
    required this.action,
    this.acceptedCommandIds = const [],
    this.rejectedCommandIds = const [],
    this.rejectionReason,
  });

  Map<String, dynamic> toJson() => {
        'resolvedAt': resolvedAt.toUtc().toIso8601String(),
        'resolvedBy': resolvedBy,
        'action': action.wireName,
        'acceptedCommandIds': acceptedCommandIds,
        'rejectedCommandIds': rejectedCommandIds,
        if (rejectionReason != null) 'rejectionReason': rejectionReason,
      };
}

/// Immutable multimodal proposal (§3, MP-INV-6). Lifecycle transitions
/// produce new instances via [copyWith]; `proposalId` never changes.
class MultimodalProposal {
  static const String contractVersion = '1.0.0';

  final String proposalId;
  final String modelId;
  final String targetModelVersion;
  final DateTime createdAt;
  final ProposalLifecycleState lifecycleState;
  final ProposalSource source;
  final ProposalConfidence confidence;
  final List<ProposalEvidence> evidences;
  final ProposalIntent intent;
  final List<ModelCommand> proposedCommands;
  final DryRunValidation? dryRunValidation;
  final ProposalResolution? resolution;

  const MultimodalProposal({
    required this.proposalId,
    required this.modelId,
    required this.targetModelVersion,
    required this.createdAt,
    required this.lifecycleState,
    required this.source,
    required this.confidence,
    required this.evidences,
    required this.intent,
    required this.proposedCommands,
    this.dryRunValidation,
    this.resolution,
  });

  bool get isResolved =>
      lifecycleState == ProposalLifecycleState.confirmed ||
      lifecycleState == ProposalLifecycleState.partiallyConfirmed ||
      lifecycleState == ProposalLifecycleState.rejected;

  MultimodalProposal copyWith({
    ProposalLifecycleState? lifecycleState,
    DryRunValidation? dryRunValidation,
    ProposalResolution? resolution,
  }) {
    return MultimodalProposal(
      proposalId: proposalId,
      modelId: modelId,
      targetModelVersion: targetModelVersion,
      createdAt: createdAt,
      lifecycleState: lifecycleState ?? this.lifecycleState,
      source: source,
      confidence: confidence,
      evidences: evidences,
      intent: intent,
      proposedCommands: proposedCommands,
      dryRunValidation: dryRunValidation ?? this.dryRunValidation,
      resolution: resolution ?? this.resolution,
    );
  }

  Map<String, dynamic> toJson() => {
        'proposalId': proposalId,
        'contractVersion': contractVersion,
        'modelId': modelId,
        'targetModelVersion': targetModelVersion,
        'createdAt': createdAt.toUtc().toIso8601String(),
        'lifecycleState': lifecycleState.wireName,
        'source': source.toJson(),
        'confidence': confidence.toJson(),
        'evidences': evidences.map((e) => e.toJson()).toList(),
        'intent': intent.toJson(),
        'proposedCommands':
            proposedCommands.map((c) => c.toJson()).toList(),
        if (dryRunValidation != null)
          'dryRunValidation': dryRunValidation!.toJson(),
        'resolution': resolution?.toJson(),
      };
}
