import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/model_command.dart';
import '../models/multimodal_proposal.dart';
import '../state/onboarding_state.dart';

/// Guided onboarding screen (task P7-004): walks the user from an initial
/// natural-language intent to a reviewed, corrected, confirmed or
/// cancelled multimodal proposal.
///
/// Nothing mutates the canonical model before the deterministic dry-run
/// gate passes and the user explicitly confirms
/// (multimodal-proposals-v1 MP-INV-2 / MP-INV-3).
class GuidedOnboardingScreen extends ConsumerStatefulWidget {
  /// Identifier recorded as `resolvedBy` in the proposal resolution (§8).
  final String userId;

  const GuidedOnboardingScreen({super.key, this.userId = 'local-user'});

  @override
  ConsumerState<GuidedOnboardingScreen> createState() =>
      _GuidedOnboardingScreenState();
}

class _GuidedOnboardingScreenState
    extends ConsumerState<GuidedOnboardingScreen> {
  final TextEditingController _intentController = TextEditingController();

  @override
  void dispose() {
    _intentController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(onboardingProvider);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Onboarding guiado'),
        backgroundColor: Theme.of(context).colorScheme.inversePrimary,
      ),
      body: switch (state) {
        OnboardingIdle() => _buildIntentStep(),
        OnboardingListening() || OnboardingTranscribing() =>
          _buildVoiceStep(state),
        OnboardingProposalReady() => _buildReviewStep(state),
        OnboardingResolved() => _buildResolvedStep(state),
      },
    );
  }

  // ---- Step 1: initial intent -------------------------------------------

  Widget _buildIntentStep() {
    return SingleChildScrollView(
      key: const Key('onboarding_step_intent'),
      padding: const EdgeInsets.all(16.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Describe tu intención de modelado',
            style: Theme.of(context).textTheme.titleLarge,
          ),
          const SizedBox(height: 8),
          Text(
            'Escribe lo que deseas crear o cambiar en el modelo. La '
            'propuesta resultante será validada de forma determinista y '
            'nunca se aplicará sin tu confirmación.',
            style: Theme.of(context).textTheme.bodyMedium,
          ),
          const SizedBox(height: 16),
          TextField(
            key: const Key('onboarding_intent_input'),
            controller: _intentController,
            maxLines: 3,
            decoration: const InputDecoration(
              border: OutlineInputBorder(),
              hintText:
                  'Ej.: "Crear clase Cliente con email de tipo String opcional"',
            ),
          ),
          const SizedBox(height: 16),
          ElevatedButton.icon(
            key: const Key('onboarding_generate'),
            icon: const Icon(Icons.auto_awesome),
            label: const Text('Generar propuesta'),
            onPressed: () => ref
                .read(onboardingProvider.notifier)
                .submitIntent(_intentController.text),
          ),
          const SizedBox(height: 24),
          const Divider(),
          const SizedBox(height: 12),
          Text(
            'O dicta tu intención: mantén pulsado el micrófono y habla. '
            'El reconocimiento es 100% local (whisper.cpp en el '
            'dispositivo) y funciona en modo avión.',
            style: Theme.of(context).textTheme.bodyMedium,
          ),
          const SizedBox(height: 12),
          Center(
            child: Listener(
              key: const Key('onboarding_voice_ptt'),
              onPointerDown: (_) => ref
                  .read(onboardingProvider.notifier)
                  .startVoiceCapture(),
              onPointerUp: (_) => ref
                  .read(onboardingProvider.notifier)
                  .stopVoiceCapture(),
              onPointerCancel: (_) => ref
                  .read(onboardingProvider.notifier)
                  .cancelVoiceCapture(),
              child: CircleAvatar(
                key: const Key('onboarding_voice_record'),
                radius: 32,
                backgroundColor:
                    Theme.of(context).colorScheme.primaryContainer,
                child: const Icon(Icons.mic, size: 32),
              ),
            ),
          ),
        ],
      ),
    );
  }

  // ---- Voice capture step (push-to-talk) --------------------------------

  Widget _buildVoiceStep(OnboardingState state) {
    final listening = state is OnboardingListening;
    return Center(
      key: Key(listening
          ? 'onboarding_step_listening'
          : 'onboarding_step_transcribing'),
      child: Padding(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              listening ? Icons.mic : Icons.graphic_eq,
              size: 56,
              color: listening
                  ? Colors.red
                  : Theme.of(context).colorScheme.primary,
            ),
            const SizedBox(height: 16),
            Text(
              listening
                  ? 'Escuchando… suelta el botón o pulsa «Detener» para '
                      'transcribir.'
                  : 'Transcribiendo con el motor de voz local…',
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 24),
            if (listening)
              ElevatedButton.icon(
                key: const Key('onboarding_voice_stop'),
                icon: const Icon(Icons.stop),
                label: const Text('Detener y transcribir'),
                onPressed: () => ref
                    .read(onboardingProvider.notifier)
                    .stopVoiceCapture(),
              )
            else
              const CircularProgressIndicator(),
            const SizedBox(height: 8),
            TextButton(
              key: const Key('onboarding_voice_cancel'),
              onPressed: () => ref
                  .read(onboardingProvider.notifier)
                  .cancelVoiceCapture(),
              child: const Text('Cancelar'),
            ),
          ],
        ),
      ),
    );
  }

  // ---- Step 2: review, correct, confirm or cancel ------------------------

  Widget _buildReviewStep(OnboardingProposalReady step) {
    final proposal = step.proposal;
    return Column(
      key: const Key('onboarding_step_review'),
      children: [
        Expanded(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(16.0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _buildSummaryCard(proposal),
                const SizedBox(height: 12),
                if (proposal.dryRunValidation != null)
                  _buildDryRunBanner(proposal.dryRunValidation!),
                if (step.resolutionErrors.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  _buildDiagnosticsCard(
                    'La confirmación fue rechazada:',
                    step.resolutionErrors,
                  ),
                ],
                const SizedBox(height: 16),
                Text(
                  'Comandos propuestos',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                const SizedBox(height: 4),
                Text(
                  'Desmarca los comandos que no desees aplicar.',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
                if (proposal.proposedCommands.isEmpty)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 12.0),
                    child: Text('No se detectaron comandos para la intención.'),
                  )
                else
                  for (var i = 0; i < proposal.proposedCommands.length; i++)
                    _buildCommandTile(proposal, i, step),
              ],
            ),
          ),
        ),
        SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(12.0),
            child: Row(
              children: [
                Expanded(
                  child: ElevatedButton.icon(
                    key: const Key('onboarding_confirm'),
                    icon: const Icon(Icons.check),
                    label: const Text('Confirmar'),
                    onPressed: step.canConfirm
                        ? () => ref
                            .read(onboardingProvider.notifier)
                            .confirm(confirmedBy: widget.userId)
                        : null,
                  ),
                ),
                const SizedBox(width: 8),
                OutlinedButton(
                  key: const Key('onboarding_edit_intent'),
                  onPressed: () =>
                      ref.read(onboardingProvider.notifier).reset(),
                  child: const Text('Corregir intención'),
                ),
                const SizedBox(width: 8),
                TextButton(
                  key: const Key('onboarding_cancel'),
                  onPressed: () => ref
                      .read(onboardingProvider.notifier)
                      .cancel(rejectedBy: widget.userId),
                  child: const Text('Cancelar'),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildSummaryCard(MultimodalProposal proposal) {
    final confidenceColor = switch (proposal.confidence.level) {
      ConfidenceLevel.high => Colors.green,
      ConfidenceLevel.medium => Colors.amber,
      ConfidenceLevel.low => Colors.red,
    };
    return Card(
      key: const Key('onboarding_proposal_summary'),
      child: Padding(
        padding: const EdgeInsets.all(12.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Intención detectada',
              style: Theme.of(context).textTheme.titleSmall,
            ),
            const SizedBox(height: 4),
            Text(proposal.intent.summary),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8.0,
              children: [
                Chip(
                  label: Text(proposal.source.modality.wireName),
                  avatar: const Icon(Icons.input, size: 18),
                ),
                Chip(
                  key: const Key('onboarding_confidence_chip'),
                  label: Text(
                    'Confianza ${proposal.confidence.level.wireName} '
                    '(${(proposal.confidence.overall * 100).round()}%)',
                  ),
                  avatar: Icon(Icons.speed, size: 18, color: confidenceColor),
                ),
              ],
            ),
            if (proposal.confidence.level == ConfidenceLevel.low)
              const Padding(
                padding: EdgeInsets.only(top: 8.0),
                child: Text(
                  'Confianza baja: revisa cada campo con atención antes de '
                  'confirmar.',
                  style: TextStyle(color: Colors.red),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildDryRunBanner(DryRunValidation dryRun) {
    final (color, icon, label) = switch (dryRun.status) {
      DryRunStatus.valid => (
          Colors.green,
          Icons.check_circle,
          'Validación determinista superada.'
        ),
      DryRunStatus.warnings => (
          Colors.amber.shade800,
          Icons.warning_amber,
          'Validación superada con advertencias.'
        ),
      DryRunStatus.invalid => (
          Colors.red,
          Icons.error_outline,
          'La propuesta no superó la validación determinista.'
        ),
    };
    return Container(
      key: Key('onboarding_dryrun_${dryRun.status.wireName.toLowerCase()}'),
      padding: const EdgeInsets.all(12.0),
      decoration: BoxDecoration(
        color: color.withAlpha(26),
        borderRadius: BorderRadius.circular(8.0),
        border: Border.all(color: color),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, color: color),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  label,
                  style: TextStyle(fontWeight: FontWeight.w600, color: color),
                ),
              ),
            ],
          ),
          for (final diagnostic in [...dryRun.errors, ...dryRun.warnings])
            Padding(
              padding: const EdgeInsets.only(top: 6.0),
              child: Text(
                '[${diagnostic.code}] ${diagnostic.message}',
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildDiagnosticsCard(String title, List<CommandDiagnostic> errors) {
    return Card(
      key: const Key('onboarding_resolution_errors'),
      color: Colors.red.shade50,
      child: Padding(
        padding: const EdgeInsets.all(12.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title, style: const TextStyle(fontWeight: FontWeight.bold)),
            for (final e in errors)
              Padding(
                padding: const EdgeInsets.only(top: 4.0),
                child: Text('[${e.code}] ${e.message}'),
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildCommandTile(
    MultimodalProposal proposal,
    int index,
    OnboardingProposalReady step,
  ) {
    final command = proposal.proposedCommands[index];
    double? score;
    for (final b in proposal.confidence.breakdown) {
      if (b.commandIndex == index) score = b.score;
    }
    return CheckboxListTile(
      key: Key('proposal_command_$index'),
      value: step.selectedCommandIds.contains(command.commandId),
      onChanged: (_) => ref
          .read(onboardingProvider.notifier)
          .toggleCommand(command.commandId),
      title: Text(_describeCommand(command)),
      subtitle: score != null
          ? Text('Confianza: ${(score * 100).round()}%')
          : null,
    );
  }

  static String _describeCommand(ModelCommand command) {
    final p = command.payload;
    return switch (command.type) {
      'CreateClass' => "Crear clase '${p['name']}'",
      'AddAttribute' =>
        "Agregar atributo '${p['name']}': ${p['type']} a '${p['classId']}'",
      'CreateAssociation' =>
        "Asociar '${p['sourceClassId']}' → '${p['targetClassId']}' "
            '(${p['sourceMultiplicity']} a ${p['targetMultiplicity']})',
      _ => '${command.type} ${jsonEncode(p)}',
    };
  }

  // ---- Step 3: resolved --------------------------------------------------

  Widget _buildResolvedStep(OnboardingResolved step) {
    final proposal = step.proposal;
    final resolution = proposal.resolution;
    final (icon, color, title) = switch (proposal.lifecycleState) {
      ProposalLifecycleState.confirmed => (
          Icons.check_circle,
          Colors.green,
          'Propuesta confirmada'
        ),
      ProposalLifecycleState.partiallyConfirmed => (
          Icons.check_circle_outline,
          Colors.green,
          'Propuesta aplicada parcialmente'
        ),
      ProposalLifecycleState.expired => (
          Icons.hourglass_disabled,
          Colors.orange,
          'La propuesta expiró'
        ),
      _ => (Icons.cancel, Colors.red, 'Propuesta cancelada'),
    };
    return ListView(
      key: const Key('onboarding_step_resolved'),
      padding: const EdgeInsets.all(16.0),
      children: [
        Icon(icon, size: 64, color: color),
        const SizedBox(height: 12),
        Center(
          child: Text(
            title,
            key: Key('onboarding_result_${proposal.lifecycleState.wireName}'),
            style: Theme.of(context).textTheme.titleLarge,
          ),
        ),
        const SizedBox(height: 8),
        if (step.applied)
          Center(
            child: Text(
              'El modelo se actualizó a la versión '
              '${ref.read(onboardingProvider.notifier).domainModel.version}.',
            ),
          )
        else
          const Center(
            child: Text('El modelo no sufrió ningún cambio.'),
          ),
        if (resolution != null) ...[
          const SizedBox(height: 12),
          Text(
            'Comandos aplicados: ${resolution.acceptedCommandIds.length} · '
            'descartados: ${resolution.rejectedCommandIds.length}',
            textAlign: TextAlign.center,
          ),
          if (resolution.rejectionReason != null)
            Padding(
              padding: const EdgeInsets.only(top: 8.0),
              child: Text(
                'Motivo: ${resolution.rejectionReason}',
                textAlign: TextAlign.center,
              ),
            ),
        ],
        const SizedBox(height: 24),
        Center(
          child: ElevatedButton.icon(
            key: const Key('onboarding_restart'),
            icon: const Icon(Icons.refresh),
            label: const Text('Nueva propuesta'),
            onPressed: () {
              _intentController.clear();
              ref.read(onboardingProvider.notifier).reset();
            },
          ),
        ),
      ],
    );
  }
}
