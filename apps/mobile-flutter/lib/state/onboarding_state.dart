import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/descriptor.dart';
import '../models/domain_model.dart';
import '../models/model_command.dart';
import '../models/multimodal_proposal.dart';
import '../services/local_interpreter.dart';
import '../services/local_speech_recognizer.dart';
import '../services/voice_input_pipeline.dart';
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

/// Push-to-talk in progress: the microphone is recording a locution for
/// the local recognizer (ADR-0005). No proposal exists yet and the
/// canonical model is untouched.
class OnboardingListening extends OnboardingState {
  const OnboardingListening();
}

/// The recording finished and the on-device ASR is transcribing the
/// captured audio. No proposal exists yet and the model is untouched.
class OnboardingTranscribing extends OnboardingState {
  const OnboardingTranscribing();
}

/// The local interpretation stage (ADR-0005 SLM, or the deterministic
/// fallback parser) is converting the user's input into a proposal. No
/// proposal exists yet and the model is untouched.
class OnboardingInterpreting extends OnboardingState {
  const OnboardingInterpreting();
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

  /// Whether a push-to-talk capture session is open. Set synchronously so
  /// a fast tap (down+up before `start()` resolves) still stops cleanly.
  bool _captureActive = false;

  /// Generation counter invalidated on cancellation so a late
  /// transcription result cannot overwrite a state the user left.
  int _captureGeneration = 0;

  @override
  OnboardingState build() => const OnboardingIdle();

  /// In-memory canonical model used as the dry-run and confirmation
  /// target. Exposed for diagnostics and tests.
  DomainModel get domainModel => _model ??= _seedModel();

  /// Step 1 → 2: converts the user's free-text [intent] into a proposal
  /// (modality `text_prompt`, §3.1.1). The local interpretation stage of
  /// ADR-0005 runs first when the on-device SLM is available; otherwise
  /// the deterministic adapter produces the proposal. Either way the
  /// output passes the mandatory dry-run gate before review (MP-INV-2).
  Future<void> submitIntent(String intent) async {
    final trimmed = intent.trim();
    if (trimmed.isEmpty) return;
    final generation = ++_captureGeneration;
    state = const OnboardingInterpreting();
    final proposal = await ref
        .read(voiceProposalServiceProvider)
        .proposeFromTranscript(
          model: domainModel,
          transcript: trimmed,
          modality: ProposalModality.textPrompt,
        );
    if (_captureGeneration != generation) return;
    state = _reviewable(proposal);
  }

  /// Starts a push-to-talk capture (§5.1.1 step 1). Only valid from the
  /// intent step. Capture-time failures (e.g. denied microphone
  /// permission) are registered as auditable INVALID proposals instead of
  /// being discarded.
  Future<void> startVoiceCapture() async {
    if (state is! OnboardingIdle || _captureActive) return;
    _captureActive = true;
    try {
      await ref.read(audioCaptureProvider).start();
      state = const OnboardingListening();
    } on SpeechRecognitionException catch (e) {
      _captureActive = false;
      state = _reviewable(ref
          .read(voiceProposalServiceProvider)
          .recognitionFailure(model: domainModel, error: e));
    }
  }

  /// Stops the capture, transcribes the audio on-device and builds the
  /// proposal through the deterministic adapter (§5.1.1 steps 2–6).
  /// Recognition errors land in the proposal's `dryRunValidation.errors`.
  Future<void> stopVoiceCapture() async {
    if (!_captureActive) return;
    _captureActive = false;
    final generation = ++_captureGeneration;
    state = const OnboardingTranscribing();
    final service = ref.read(voiceProposalServiceProvider);
    SpeechAudio audio;
    try {
      audio = await ref.read(audioCaptureProvider).stop();
    } on SpeechRecognitionException catch (e) {
      if (_captureGeneration != generation) return;
      state = _reviewable(
          service.recognitionFailure(model: domainModel, error: e));
      return;
    }
    final proposal =
        await service.proposeFromAudio(model: domainModel, audio: audio);
    if (_captureGeneration != generation) return;
    state = _reviewable(proposal);
  }

  /// Aborts an in-progress capture or an in-flight transcription or
  /// interpretation (e.g. gesture cancelled). No audio is kept and no
  /// proposal is created.
  Future<void> cancelVoiceCapture() async {
    _captureGeneration++;
    if (!_captureActive) {
      if (state is OnboardingListening ||
          state is OnboardingTranscribing ||
          state is OnboardingInterpreting) {
        state = const OnboardingIdle();
      }
      return;
    }
    _captureActive = false;
    try {
      await ref.read(audioCaptureProvider).cancel();
    } on SpeechRecognitionException {
      // Best-effort release; nothing was captured.
    }
    state = const OnboardingIdle();
  }

  OnboardingProposalReady _reviewable(MultimodalProposal proposal) =>
      OnboardingProposalReady(
        proposal: proposal,
        selectedCommandIds:
            proposal.proposedCommands.map((c) => c.commandId).toSet(),
      );

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

/// Provider for the on-device speech recognizer (ADR-0005). The default
/// implementation talks to the Android whisper.cpp bridge and never uses
/// the network; tests and non-Android builds override it with a fake.
final localSpeechRecognizerProvider = Provider<LocalSpeechRecognizer>(
  (ref) => const WhisperChannelRecognizer(),
);

/// Provider for the on-device interpretation engine (ADR-0005, SLM
/// stage). The default implementation talks to the Android llama.cpp
/// bridge and never uses the network; when the engine or its weights are
/// absent the pipeline degrades to the deterministic adapter.
final localInterpreterProvider = Provider<LocalInterpreter>(
  (ref) => const LlamaChannelInterpreter(),
);

/// Provider for the push-to-talk PCM capture source.
final audioCaptureProvider = Provider<AudioCaptureSource>(
  (ref) => const MethodChannelAudioCapture(),
);

/// Provider for the local proposal pipeline
/// (capture → recognizer → interpreter → adapter).
final voiceProposalServiceProvider = Provider<VoiceProposalService>(
  (ref) => VoiceProposalService(
    recognizer: ref.watch(localSpeechRecognizerProvider),
    interpreter: ref.watch(localInterpreterProvider),
  ),
);
