import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/descriptor.dart';
import '../models/domain_model.dart';
import '../models/model_command.dart';
import '../models/multimodal_proposal.dart';
import '../services/voice_proposal_adapter.dart';
import 'descriptor_state.dart';

/// Lifecycle of the guided onboarding flow (task P7-004).
///
/// The flow mirrors the proposal lifecycle of multimodal-proposals-v1 §4:
/// the user states an initial intent, the adapter produces a proposal that
/// has already passed the deterministic dry-run gate (MP-INV-2), the user
/// reviews and optionally corrects the proposed commands, and only an
/// explicit confirmation mutates the canonical model (MP-INV-3).
sealed class OnboardingState {
  const OnboardingState();
}

/// Step 1 — awaiting the user's initial intent. No proposal exists yet and
/// the canonical model is untouched.
class OnboardingIdle extends OnboardingState {
  const OnboardingIdle();
}

/// Step 2 — a proposal was generated and dry-run validated; it is being
/// presented for review. The user may deselect commands (correction via
/// `confirm_selection`, §8.1 rule 3 and decision D6), confirm or cancel.
/// No model mutation has occurred in this state.
class OnboardingProposalReady extends OnboardingState {
  final MultimodalProposal proposal;

  /// Commands the user keeps selected for confirmation. Initialized with
  /// every proposed command; deselecting discards hallucinations (D6).
  final Set<String> selectedCommandIds;

  /// Diagnostics produced by the last refused confirmation attempt (e.g.
  /// `INVALID_COMMAND_SELECTION`). Empty when the review is clean.
  final List<CommandDiagnostic> resolutionErrors;

  const OnboardingProposalReady({
    required this.proposal,
    required this.selectedCommandIds,
    this.resolutionErrors = const [],
  });

  /// Whether the deterministic dry-run rejected the proposal. Invalid
  /// proposals can only be inspected and cancelled, never confirmed
  /// (MP-INV-2, §4 state `dry_run_validated`).
  bool get isInvalid =>
      proposal.dryRunValidation == null ||
      proposal.dryRunValidation!.status == DryRunStatus.invalid;

  /// A proposal is confirmable when it passed the dry-run and at least one
  /// command remains selected.
  bool get canConfirm => !isInvalid && selectedCommandIds.isNotEmpty;
}

/// Step 3 — terminal state of the flow: the proposal reached a resolved
/// lifecycle state (`confirmed`, `partially_confirmed`, `rejected` or
/// `expired`). [applied] is true only when commands mutated the model.
class OnboardingResolved extends OnboardingState {
  final MultimodalProposal proposal;
  final bool applied;

  const OnboardingResolved({required this.proposal, required this.applied});
}

/// Riverpod notifier driving the guided onboarding flow.
///
/// Holds the in-memory canonical model that proposals target: it is seeded
/// lazily from the active flutter descriptor so the dry-run validates
/// against the same classes the user sees, and it accumulates confirmed
/// mutations across successive proposals of the session.
class OnboardingNotifier extends Notifier<OnboardingState> {
  final VoiceProposalAdapter _adapter =
      VoiceProposalAdapter(agentRole: 'guided-onboarding-adapter-v1');
  DomainModel? _model;

  @override
  OnboardingState build() => const OnboardingIdle();

  /// In-memory canonical model used as the dry-run and confirmation
  /// target. Exposed for diagnostics and tests.
  DomainModel get domainModel => _model ??= _seedModel();

  /// Step 1 → 2: converts the user's free-text [intent] into a proposal
  /// (modality `text_prompt`, §3.1.1) through the deterministic gate and
  /// presents it for review.
  void submitIntent(String intent) {
    final trimmed = intent.trim();
    if (trimmed.isEmpty) return;
    final proposal = _adapter.propose(
      model: domainModel,
      transcript: trimmed,
      modality: ProposalModality.textPrompt,
    );
    state = OnboardingProposalReady(
      proposal: proposal,
      selectedCommandIds:
          proposal.proposedCommands.map((c) => c.commandId).toSet(),
    );
  }

  /// Toggles a proposed command in or out of the confirmation selection
  /// (correction path, §8.1 `confirm_selection`). Only valid while the
  /// proposal awaits review.
  void toggleCommand(String commandId) {
    final current = state;
    if (current is! OnboardingProposalReady) return;
    final next = {...current.selectedCommandIds};
    if (!next.remove(commandId)) next.add(commandId);
    state = OnboardingProposalReady(
      proposal: current.proposal,
      selectedCommandIds: next,
      resolutionErrors: current.resolutionErrors,
    );
  }

  /// Confirms the proposal: `confirm_all` when every command is selected,
  /// otherwise `confirm_selection` (§8.1). The canonical model is mutated
  /// only when the deterministic processor accepts the whole selection.
  /// A refused confirmation keeps the review open with diagnostics.
  void confirm({String confirmedBy = 'local-user'}) {
    final current = state;
    if (current is! OnboardingProposalReady) return;
    if (current.selectedCommandIds.isEmpty) {
      state = OnboardingProposalReady(
        proposal: current.proposal,
        selectedCommandIds: current.selectedCommandIds,
        resolutionErrors: const [
          CommandDiagnostic(
            code: 'INVALID_COMMAND_SELECTION',
            path: r'$.selectedCommandIds',
            message:
                'Debe seleccionar al menos un comando propuesto para confirmar.',
            severity: DiagnosticSeverity.error,
          ),
        ],
      );
      return;
    }
    final allSelected = current.selectedCommandIds.length ==
        current.proposal.proposedCommands.length;
    final outcome = _adapter.confirm(
      proposal: current.proposal,
      model: domainModel,
      confirmedBy: confirmedBy,
      selectedCommandIds: allSelected
          ? null
          : current.selectedCommandIds.toList(growable: false),
    );
    final resolved = outcome.proposal;
    if (outcome.applied ||
        resolved.isResolved ||
        resolved.lifecycleState == ProposalLifecycleState.expired) {
      state = OnboardingResolved(proposal: resolved, applied: outcome.applied);
    } else {
      state = OnboardingProposalReady(
        proposal: resolved,
        selectedCommandIds: current.selectedCommandIds,
        resolutionErrors: outcome.errors,
      );
    }
  }

  /// Cancels the flow (§8.2): the proposal is rejected and the canonical
  /// model is guaranteed to remain byte-identical.
  void cancel({String rejectedBy = 'local-user', String? reason}) {
    final current = state;
    if (current is! OnboardingProposalReady) return;
    final outcome = _adapter.reject(
      proposal: current.proposal,
      rejectedBy: rejectedBy,
      reason: reason ?? 'Cancelada por el usuario en el onboarding guiado.',
    );
    state = OnboardingResolved(proposal: outcome.proposal, applied: false);
  }

  /// Returns to the intent step, discarding any pending review.
  void reset() => state = const OnboardingIdle();

  DomainModel _seedModel() {
    final descriptorState = ref.read(descriptorProvider);
    if (descriptorState is DescriptorReady) {
      return _domainModelFromDescriptor(descriptorState.descriptor);
    }
    return DomainModel(
      id: 'onboarding-local-model',
      name: 'Onboarding',
      version: '0.0.1',
    );
  }

  static DomainModel _domainModelFromDescriptor(DescriptorRoot descriptor) {
    return DomainModel(
      id: descriptor.sourceModelId,
      name: 'Modelo ${descriptor.sourceModelId}',
      version: descriptor.sourceModelVersion,
      classes: descriptor.classes
          .map((c) => DomainClass(
                id: c.id,
                name: c.name,
                isAbstract: c.isAbstract,
                description: c.description,
                attributes: c.attributes
                    .map((a) => DomainAttribute(
                          id: a.id,
                          name: a.name,
                          type: a.type,
                          nullable: a.nullable,
                          multiplicity: a.multiplicity,
                          description: a.description,
                        ))
                    .toList(),
              ))
          .toList(),
      associations: descriptor.associations
          .map((a) => DomainAssociation(
                id: a.id,
                name: a.name,
                sourceClassId: a.sourceClassId,
                targetClassId: a.targetClassId,
                sourceMultiplicity: a.sourceMultiplicity,
                targetMultiplicity: a.targetMultiplicity,
                navigability: a.navigability,
                description: a.description,
              ))
          .toList(),
    );
  }
}

/// Global provider for the guided onboarding flow state.
final onboardingProvider =
    NotifierProvider<OnboardingNotifier, OnboardingState>(
        OnboardingNotifier.new);
