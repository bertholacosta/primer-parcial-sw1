import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:uuid/uuid.dart';

import '../models/domain_model.dart';
import '../models/model_command.dart';
import '../models/multimodal_proposal.dart';
import 'local_interpreter.dart';
import 'model_command_processor.dart';

/// Outcome of a confirmation or rejection request over a proposal
/// (multimodal-proposals-v1 §8).
class ProposalResolutionOutcome {
  /// The proposal after the attempted transition (immutable, MP-INV-6).
  final MultimodalProposal proposal;

  /// Whether commands were dispatched and applied to the model.
  final bool applied;

  /// Diagnostics explaining a refused resolution (empty when successful).
  final List<CommandDiagnostic> errors;

  const ProposalResolutionOutcome({
    required this.proposal,
    required this.applied,
    this.errors = const [],
  });
}

/// Modelling intent parsed from a transcript fragment.
sealed class _TranscriptIntent {
  final int start;
  const _TranscriptIntent(this.start);
}

class _ClassIntent extends _TranscriptIntent {
  final String name;
  const _ClassIntent(super.start, this.name);
}

class _AttributeIntent extends _TranscriptIntent {
  final int end;
  final String attributeName;
  final String typeName;
  final String? modifier;
  final String? targetClassName;
  const _AttributeIntent(
    super.start,
    this.end,
    this.attributeName,
    this.typeName,
    this.modifier,
    this.targetClassName,
  );
}

class _AssociationIntent extends _TranscriptIntent {
  final String sourceName;
  final String targetName;
  final String sourceMultiplicity;
  final String targetMultiplicity;
  final bool explicitCardinality;
  const _AssociationIntent(
    super.start,
    this.sourceName,
    this.targetName,
    this.sourceMultiplicity,
    this.targetMultiplicity,
    this.explicitCardinality,
  );
}

/// Adapter that converts a voice transcript into an auditable,
/// confirmable [MultimodalProposal] (multimodal-proposals-v1 §5.1).
///
/// The adapter deliberately performs no audio capture and no speech
/// recognition: the transcript is supplied by the on-device engine of
/// ADR-0005 through `VoiceProposalService` / `LocalSpeechRecognizer`
/// (or injected directly in tests and text-prompt flows). All parsing and
/// validation is deterministic and local; no network access is required.
class VoiceProposalAdapter {
  VoiceProposalAdapter({
    ModelCommandProcessor? processor,
    this.clientPlatform = 'android',
    this.agentRole = 'voice-transcript-adapter-v1',
    DateTime Function()? clock,
  })  : _processor = processor ?? ModelCommandProcessor(),
        _clock = clock ?? DateTime.now;

  final ModelCommandProcessor _processor;
  final String clientPlatform;
  final String agentRole;
  final DateTime Function() _clock;

  static const Uuid _uuid = Uuid();

  // "Crear clase Cliente", "nueva entidad Pedido", "agregar la clase X".
  static final RegExp _classPattern = RegExp(
    r'(?:crear|crea|nueva|nuevo|registrar|registra|agregar|agrega|añadir|añade)'
    r'\s+(?:(?:una?|la|el)\s+)?(?:clase|entidad)\s+([A-Za-z_][A-Za-z0-9_]*)',
    caseSensitive: false,
  );

  // "agregar campo salario de tipo Decimal a la clase Empleado".
  static final RegExp _explicitAttributePattern = RegExp(
    r'(?:agregar|agrega|añadir|añade|incorporar?|sumar?)\s+'
    r'(?:(?:un|una|el|la)\s+)?(?:campo|atributo|propiedad)\s+'
    r'([A-Za-z_][A-Za-z0-9_]*)\s+de\s+tipo\s+([A-Za-z][A-Za-z0-9]*)'
    r'\s*(?:(obligatorio|opcional|requerido|no\s+nulo|nulo)\s+)?'
    r'(?:a|en)\s+la\s+clase\s+([A-Za-z_][A-Za-z0-9_]*)',
    caseSensitive: false,
  );

  // "un Cliente tiene muchos Pedidos".
  static final RegExp _possessiveAssociationPattern = RegExp(
    r'(?:un|una|el|la)\s+([A-Za-z_][A-Za-z0-9_]*)\s+tiene\s+'
    r'(muchos|muchas|varios|varias|un|una)\s+([A-Za-z_][A-Za-z0-9_]*)',
    caseSensitive: false,
  );

  // "asociar Factura con Item de uno a muchos".
  static final RegExp _explicitAssociationPattern = RegExp(
    r'asociar?\s+([A-Za-z_][A-Za-z0-9_]*)\s+con\s+([A-Za-z_][A-Za-z0-9_]*)'
    r'\s+de\s+(uno|muchos)\s+a\s+(uno|muchos)',
    caseSensitive: false,
  );

  // "<attr> de tipo <Type> [obligatorio|opcional|no nulo|nulo]".
  static final RegExp _genericAttributePattern = RegExp(
    r'([A-Za-z_][A-Za-z0-9_]*)\s+de\s+tipo\s+([A-Za-z][A-Za-z0-9]*)'
    r'\s*(obligatorio|opcional|requerido|no\s+nulo|nulo)?',
    caseSensitive: false,
  );

  static final RegExp _bidirectionalPattern =
      RegExp('bidireccional', caseSensitive: false);

  /// Converts an injected [transcript] into a confirmable proposal for
  /// [model] (§5.1). Always runs the deterministic dry-run gate before
  /// returning (MP-INV-2): VALID/WARNINGS proposals land in
  /// `awaiting_confirmation`; INVALID ones stay `dry_run_validated` for
  /// user inspection (§4, example 9.3).
  ///
  /// [mediaSha256] should be the hash of the raw audio buffer when one
  /// exists; with a pure injected transcript the transcript's own SHA-256
  /// is used as the auditable input hash (MP-INV-4/MP-INV-5).
  ///
  /// [modality] declares the real input channel (§3.1.1): `voice` for
  /// captured audio (default) or `text_prompt` for text typed directly by
  /// the user (e.g. the guided onboarding flow). Text prompts produce a
  /// `text_transcript` evidence instead of an `audio_segment` one.
  MultimodalProposal propose({
    required DomainModel model,
    required String transcript,
    String? mediaSha256,
    int? audioStartMs,
    int? audioEndMs,
    DateTime? capturedAt,
    ProposalModality modality = ProposalModality.voice,
  }) {
    final now = _clock().toUtc();
    final intents = _parseTranscript(transcript);
    final bidirectional = _bidirectionalPattern.hasMatch(transcript);

    // name (lowercased) → classId for existing classes and classes created
    // by this same transcript.
    final classIds = <String, String>{
      for (final c in model.classes) c.name.toLowerCase(): c.id,
    };
    final usedIds = <String>{
      ...model.packages.map((p) => p.id),
      ...model.classes.map((c) => c.id),
      ...model.classes.expand((c) => c.attributes.map((a) => a.id)),
      ...model.associations.map((a) => a.id),
    };

    final commands = <ModelCommand>[];
    final breakdown = <ConfidenceBreakdown>[];
    final summaryParts = <String>[];
    final proposalErrors = <CommandDiagnostic>[];

    String? lastClassId;
    String? lastClassName;

    for (final intent in intents) {
      switch (intent) {
        case _ClassIntent(:final name):
          final classId = _uniqueId('cls-${name.toLowerCase()}', usedIds);
          commands.add(_command(
            model,
            'CreateClass',
            {'id': classId, 'name': name},
          ));
          classIds[name.toLowerCase()] = classId;
          lastClassId = classId;
          lastClassName = name;
          breakdown.add(ConfidenceBreakdown(
            commandIndex: commands.length - 1,
            score: 0.95,
            fieldScores: {'name': 0.95, 'id': 1.0},
          ));
          summaryParts.add("Crear la clase '$name'");

        case _AttributeIntent(
            :final attributeName,
            :final typeName,
            :final modifier,
            :final targetClassName
          ):
          String? classId;
          String? className;
          if (targetClassName != null) {
            className = targetClassName;
            classId = classIds[targetClassName.toLowerCase()] ??
                'cls-${targetClassName.toLowerCase()}';
          } else if (lastClassId != null) {
            classId = lastClassId;
            className = lastClassName;
          }
          if (classId == null || className == null) {
            // Fragment without modelling context: omitted per §6.4.
            continue;
          }
          final normalized = _normalizeModifier(modifier);
          final attrId = _uniqueId(
            'attr-${className.toLowerCase()}-${attributeName.toLowerCase()}',
            usedIds,
          );
          commands.add(_command(
            model,
            'AddAttribute',
            {
              'id': attrId,
              'classId': classId,
              'name': attributeName,
              'type': typeName,
              'nullable': !normalized,
              'multiplicity': normalized ? '1' : '0..1',
            },
          ));
          final knownType = DomainModel.allowedTypes.contains(typeName);
          final modifierScore = modifier != null ? 0.90 : 0.70;
          final fieldScores = <String, double>{
            'name': 0.92,
            'type': knownType ? 0.95 : 0.50,
            'nullable': modifierScore,
            'multiplicity': modifierScore,
          };
          breakdown.add(ConfidenceBreakdown(
            commandIndex: commands.length - 1,
            score: _mean(fieldScores.values),
            fieldScores: fieldScores,
          ));
          summaryParts.add(
            "Agregar el atributo '$attributeName' de tipo '$typeName' "
            "a la clase '$className'",
          );

        case _AssociationIntent(
            :final sourceName,
            :final targetName,
            :final sourceMultiplicity,
            :final targetMultiplicity,
            :final explicitCardinality
          ):
          final sourceId = _resolveClassId(classIds, sourceName);
          final targetId = _resolveClassId(classIds, targetName);
          final sourceResolved = sourceId != null;
          final targetResolved = targetId != null;
          commands.add(_command(
            model,
            'CreateAssociation',
            {
              'id': _uniqueId(
                'assoc-${sourceName.toLowerCase()}-${targetName.toLowerCase()}',
                usedIds,
              ),
              'sourceClassId': sourceId ?? 'cls-${sourceName.toLowerCase()}',
              'targetClassId': targetId ?? 'cls-${targetName.toLowerCase()}',
              'sourceMultiplicity': sourceMultiplicity,
              'targetMultiplicity': targetMultiplicity,
              'navigability':
                  bidirectional ? 'bidirectional' : 'unidirectional',
            },
          ));
          final cardinalityScore = explicitCardinality ? 0.85 : 0.75;
          final fieldScores = <String, double>{
            'sourceClassId': sourceResolved ? 0.90 : 0.55,
            'targetClassId': targetResolved ? 0.90 : 0.55,
            'sourceMultiplicity': cardinalityScore,
            'targetMultiplicity': cardinalityScore,
            'navigability': 0.80,
          };
          breakdown.add(ConfidenceBreakdown(
            commandIndex: commands.length - 1,
            score: _mean(fieldScores.values),
            fieldScores: fieldScores,
          ));
          summaryParts.add(
            "Asociar '$sourceName' con '$targetName' "
            '($sourceMultiplicity a $targetMultiplicity)',
          );
      }
    }

    if (commands.isEmpty) {
      proposalErrors.add(const CommandDiagnostic(
        code: 'INTENT_UNRECOGNIZED',
        path: r'$.intent.rawPrompt',
        message:
            'La transcripción no contiene intenciones de modelado UML reconocibles.',
        severity: DiagnosticSeverity.error,
      ));
    }

    return _assembleProposal(
      model: model,
      transcript: transcript,
      commands: commands,
      breakdown: breakdown,
      summaryParts: summaryParts,
      proposalErrors: proposalErrors,
      now: now,
      mediaSha256: mediaSha256,
      audioStartMs: audioStartMs,
      audioEndMs: audioEndMs,
      capturedAt: capturedAt,
      modality: modality,
    );
  }

  /// Converts the structured output of the on-device SLM
  /// ([InterpretationResult], produced by llama.cpp/Qwen2.5 per ADR-0005)
  /// into a confirmable proposal. The SLM only contributes `type`,
  /// `payload` and confidence scores; command envelopes are stamped
  /// deterministically here (multimodal-proposals-v1 S2) and the
  /// mandatory dry-run gate (MP-INV-2) decides validity exactly as in the
  /// deterministic parsing path.
  ///
  /// An `inference_rationale` evidence is attached alongside the media
  /// evidence so the SLM extraction remains auditable (MP-INV-4).
  MultimodalProposal proposeFromInterpretation({
    required DomainModel model,
    required String transcript,
    required InterpretationResult interpretation,
    String? mediaSha256,
    int? audioStartMs,
    int? audioEndMs,
    DateTime? capturedAt,
    ProposalModality modality = ProposalModality.voice,
    String? agentRole,
  }) {
    final now = _clock().toUtc();
    final commands = <ModelCommand>[];
    final breakdown = <ConfidenceBreakdown>[];
    final proposalErrors = <CommandDiagnostic>[];

    for (final inferred in interpretation.commands) {
      commands.add(ModelCommand(
        type: inferred.type,
        commandId: _uuid.v4(),
        modelId: model.id,
        modelVersion: model.version,
        payload: Map<String, dynamic>.from(inferred.payload),
      ));
      breakdown.add(ConfidenceBreakdown(
        commandIndex: commands.length - 1,
        score: inferred.score,
        fieldScores: inferred.fieldScores,
      ));
    }

    if (commands.isEmpty) {
      proposalErrors.add(const CommandDiagnostic(
        code: 'NO_COMMANDS_GENERATED',
        path: r'$.intent.rawPrompt',
        message:
            'El modelo de lenguaje local no dedujo comandos válidos para el metamodelo v1.',
        severity: DiagnosticSeverity.error,
      ));
    }

    final rationale = StringBuffer(
      'Interpretación del SLM local (llama.cpp/Qwen2.5 on-device, '
      'ADR-0005): ${interpretation.intentSummary}',
    );
    if (interpretation.elapsedMs != null) {
      rationale.write(' · ${interpretation.elapsedMs} ms');
    }
    if (interpretation.generatedTokens != null) {
      rationale.write(' · ${interpretation.generatedTokens} tokens');
    }

    return _assembleProposal(
      model: model,
      transcript: transcript,
      commands: commands,
      breakdown: breakdown,
      summaryParts: [interpretation.intentSummary],
      proposalErrors: proposalErrors,
      now: now,
      mediaSha256: mediaSha256,
      audioStartMs: audioStartMs,
      audioEndMs: audioEndMs,
      capturedAt: capturedAt,
      modality: modality,
      agentRole: agentRole,
      extraEvidences: [
        ProposalEvidence(
          evidenceId: _uuid.v4(),
          type: EvidenceType.inferenceRationale,
          mediaSha256: mediaSha256 ??
              sha256
                  .convert(utf8.encode(interpretation.rawOutput ?? transcript))
                  .toString(),
          payload: EvidencePayload(description: rationale.toString()),
        ),
      ],
    );
  }

  /// Shared assembly of the proposal artifact: confidence aggregation,
  /// mandatory deterministic dry-run and lifecycle assignment. Used by
  /// the deterministic parsing path ([propose]) and the SLM
  /// interpretation path ([proposeFromInterpretation]) so both are held
  /// to the same gate (MP-INV-2).
  MultimodalProposal _assembleProposal({
    required DomainModel model,
    required String transcript,
    required List<ModelCommand> commands,
    required List<ConfidenceBreakdown> breakdown,
    required List<String> summaryParts,
    required List<CommandDiagnostic> proposalErrors,
    required DateTime now,
    String? mediaSha256,
    int? audioStartMs,
    int? audioEndMs,
    DateTime? capturedAt,
    ProposalModality modality = ProposalModality.voice,
    String? agentRole,
    List<ProposalEvidence> extraEvidences = const [],
  }) {
    final overall = breakdown.isEmpty
        ? 0.0
        : _mean(breakdown.map((b) => b.score));
    if (commands.isNotEmpty && overall < 0.40) {
      proposalErrors.add(const CommandDiagnostic(
        code: 'CONFIDENCE_BELOW_THRESHOLD',
        path: r'$.confidence.overall',
        message:
            'La confianza general es menor al umbral mínimo de procesamiento seguro (0.40).',
        severity: DiagnosticSeverity.error,
      ));
    }

    final DryRunValidation dryRun;
    if (commands.isNotEmpty) {
      final result = _processor.dryRun(model, commands);
      final allErrors = [...proposalErrors, ...result.errors];
      dryRun = DryRunValidation(
        status: allErrors.isNotEmpty
            ? DryRunStatus.invalid
            : (result.warnings.isNotEmpty
                ? DryRunStatus.warnings
                : DryRunStatus.valid),
        validatedAt: now,
        errors: allErrors,
        warnings: result.warnings,
      );
    } else {
      dryRun = DryRunValidation(
        status: DryRunStatus.invalid,
        validatedAt: now,
        errors: proposalErrors,
      );
    }

    final isVoice = modality == ProposalModality.voice;
    final evidence = ProposalEvidence(
      evidenceId: _uuid.v4(),
      type: isVoice ? EvidenceType.audioSegment : EvidenceType.textTranscript,
      mediaSha256:
          mediaSha256 ?? sha256.convert(utf8.encode(transcript)).toString(),
      payload: EvidencePayload(
        textTranscript: transcript,
        audioTimeRange:
            (isVoice && audioStartMs != null && audioEndMs != null)
                ? AudioTimeRange(startMs: audioStartMs, endMs: audioEndMs)
                : null,
        description: isVoice
            ? 'Locución transcrita por el reconocedor local del dispositivo (ADR-0005).'
            : 'Prompt de texto ingresado directamente por el usuario.',
      ),
    );

    return MultimodalProposal(
      proposalId: _uuid.v4(),
      modelId: model.id,
      targetModelVersion: model.version,
      createdAt: now,
      lifecycleState: dryRun.status == DryRunStatus.invalid
          ? ProposalLifecycleState.dryRunValidated
          : ProposalLifecycleState.awaitingConfirmation,
      source: ProposalSource(
        modality: modality,
        clientPlatform: clientPlatform,
        agentRole: agentRole ?? this.agentRole,
        capturedAt: (capturedAt ?? now).toUtc(),
      ),
      confidence: ProposalConfidence(
        overall: overall,
        level: overall >= 0.85
            ? ConfidenceLevel.high
            : (overall >= 0.60 ? ConfidenceLevel.medium : ConfidenceLevel.low),
        breakdown: breakdown,
      ),
      evidences: [evidence, ...extraEvidences],
      intent: ProposalIntent(
        summary: summaryParts.isEmpty
            ? 'Sin intenciones de modelado detectadas.'
            : summaryParts.join('; '),
        rawPrompt: transcript,
      ),
      proposedCommands: commands,
      dryRunValidation: dryRun,
    );
  }

  /// Confirms a proposal and dispatches its commands atomically
  /// (§8.1). Confirmation is refused unless the proposal passed the
  /// deterministic dry-run (`VALID`/`WARNINGS`) and the model version still
  /// matches. Returns the updated proposal; [model] is mutated only when
  /// every selected command is accepted.
  ProposalResolutionOutcome confirm({
    required MultimodalProposal proposal,
    required DomainModel model,
    required String confirmedBy,
    String? expectedModelVersion,
    List<String>? selectedCommandIds,
  }) {
    CommandDiagnostic err(String code, String path, String msg) =>
        CommandDiagnostic(
            code: code,
            path: path,
            message: msg,
            severity: DiagnosticSeverity.error);

    if (proposal.isResolved || proposal.resolution != null) {
      return ProposalResolutionOutcome(
        proposal: proposal,
        applied: false,
        errors: [
          err('PROPOSAL_ALREADY_RESOLVED', r'$.lifecycleState',
              "La propuesta '${proposal.proposalId}' ya fue resuelta."),
        ],
      );
    }
    if (proposal.lifecycleState == ProposalLifecycleState.expired) {
      return ProposalResolutionOutcome(
        proposal: proposal,
        applied: false,
        errors: [
          err('PROPOSAL_EXPIRED', r'$.lifecycleState',
              "La propuesta '${proposal.proposalId}' ha caducado."),
        ],
      );
    }
    // MP-INV-2: confirmation requires a successful deterministic validation.
    final dryRun = proposal.dryRunValidation;
    final stateOk =
        proposal.lifecycleState == ProposalLifecycleState.awaitingConfirmation ||
            proposal.lifecycleState ==
                ProposalLifecycleState.dryRunValidated;
    if (!stateOk || dryRun == null || dryRun.status == DryRunStatus.invalid) {
      return ProposalResolutionOutcome(
        proposal: proposal,
        applied: false,
        errors: [
          err(
              'DETERMINISTIC_PRECONDITION_FAILED',
              r'$.dryRunValidation',
              'La propuesta no superó la validación determinista previa; no puede confirmarse.'),
          ...?dryRun?.errors,
        ],
      );
    }
    // §8.1 rule 2: optimistic concurrency against the live model.
    final expected = expectedModelVersion ?? proposal.targetModelVersion;
    if (model.version != expected) {
      final expired = proposal.copyWith(
        lifecycleState: ProposalLifecycleState.expired,
        resolution: ProposalResolution(
          resolvedAt: _clock().toUtc(),
          resolvedBy: confirmedBy,
          action: ResolutionAction.expire,
          rejectedCommandIds:
              proposal.proposedCommands.map((c) => c.commandId).toList(),
        ),
      );
      return ProposalResolutionOutcome(
        proposal: expired,
        applied: false,
        errors: [
          err('PROPOSAL_EXPIRED', r'$.targetModelVersion',
              "El modelo está en versión '${model.version}' pero la propuesta esperaba '$expected'."),
        ],
      );
    }

    // §8.1 rule 3 / confirm_selection: validate the subset integrity.
    List<ModelCommand> selected;
    if (selectedCommandIds == null) {
      selected = proposal.proposedCommands;
    } else {
      final byId = {
        for (final c in proposal.proposedCommands) c.commandId: c,
      };
      final unknown =
          selectedCommandIds.where((id) => !byId.containsKey(id)).toList();
      if (unknown.isNotEmpty) {
        return ProposalResolutionOutcome(
          proposal: proposal,
          applied: false,
          errors: [
            err('INVALID_COMMAND_SELECTION', r'$.selectedCommandIds',
                'Comandos seleccionados inexistentes en la propuesta: ${unknown.join(', ')}.'),
          ],
        );
      }
      selected = proposal.proposedCommands
          .where((c) => selectedCommandIds.contains(c.commandId))
          .toList();
      final broken = _findBrokenDependencies(proposal, selected, model);
      if (broken.isNotEmpty) {
        return ProposalResolutionOutcome(
          proposal: proposal,
          applied: false,
          errors: broken,
        );
      }
    }

    // §8.1 rules 4–6: atomic dispatch through the canonical processor.
    final result = _processor.applyBatch(model, selected);
    if (!result.applied) {
      return ProposalResolutionOutcome(
        proposal: proposal,
        applied: false,
        errors: result.errors,
      );
    }

    final acceptedIds = selected.map((c) => c.commandId).toList();
    final rejectedIds = proposal.proposedCommands
        .where((c) => !acceptedIds.contains(c.commandId))
        .map((c) => c.commandId)
        .toList();
    final resolved = proposal.copyWith(
      lifecycleState: rejectedIds.isEmpty
          ? ProposalLifecycleState.confirmed
          : ProposalLifecycleState.partiallyConfirmed,
      resolution: ProposalResolution(
        resolvedAt: _clock().toUtc(),
        resolvedBy: confirmedBy,
        action: selectedCommandIds == null
            ? ResolutionAction.confirmAll
            : ResolutionAction.confirmSelection,
        acceptedCommandIds: acceptedIds,
        rejectedCommandIds: rejectedIds,
      ),
    );
    return ProposalResolutionOutcome(proposal: resolved, applied: true);
  }

  /// Rejects a proposal (§8.2). Never touches the canonical model.
  ProposalResolutionOutcome reject({
    required MultimodalProposal proposal,
    required String rejectedBy,
    String? reason,
  }) {
    if (proposal.isResolved || proposal.resolution != null) {
      return ProposalResolutionOutcome(
        proposal: proposal,
        applied: false,
        errors: [
          const CommandDiagnostic(
            code: 'PROPOSAL_ALREADY_RESOLVED',
            path: r'$.lifecycleState',
            message: 'La propuesta ya fue resuelta.',
            severity: DiagnosticSeverity.error,
          ),
        ],
      );
    }
    final rejected = proposal.copyWith(
      lifecycleState: ProposalLifecycleState.rejected,
      resolution: ProposalResolution(
        resolvedAt: _clock().toUtc(),
        resolvedBy: rejectedBy,
        action: ResolutionAction.reject,
        rejectedCommandIds:
            proposal.proposedCommands.map((c) => c.commandId).toList(),
        rejectionReason: reason,
      ),
    );
    return ProposalResolutionOutcome(proposal: rejected, applied: false);
  }

  // ---- Transcript parsing ----------------------------------------------

  List<_TranscriptIntent> _parseTranscript(String transcript) {
    final intents = <_TranscriptIntent>[];
    final consumedSpans = <(int, int)>[];

    for (final m in _explicitAttributePattern.allMatches(transcript)) {
      intents.add(_AttributeIntent(
          m.start, m.end, m.group(1)!, m.group(2)!, m.group(3), m.group(4)));
      consumedSpans.add((m.start, m.end));
    }
    for (final m in _explicitAssociationPattern.allMatches(transcript)) {
      intents.add(_AssociationIntent(
        m.start,
        m.group(1)!,
        m.group(2)!,
        _cardinality(m.group(3)!),
        _cardinality(m.group(4)!),
        true,
      ));
      consumedSpans.add((m.start, m.end));
    }
    for (final m in _possessiveAssociationPattern.allMatches(transcript)) {
      final many = m.group(2)!.toLowerCase();
      intents.add(_AssociationIntent(
        m.start,
        m.group(1)!,
        m.group(3)!,
        '1',
        (many == 'un' || many == 'una') ? '1' : '1..*',
        false,
      ));
      consumedSpans.add((m.start, m.end));
    }
    for (final m in _classPattern.allMatches(transcript)) {
      intents.add(_ClassIntent(m.start, m.group(1)!));
      consumedSpans.add((m.start, m.end));
    }
    for (final m in _genericAttributePattern.allMatches(transcript)) {
      final insideConsumed = consumedSpans
          .any((s) => m.start >= s.$1 && m.end <= s.$2);
      if (insideConsumed) continue;
      intents.add(_AttributeIntent(
          m.start, m.end, m.group(1)!, m.group(2)!, m.group(3), null));
    }

    intents.sort((a, b) => a.start.compareTo(b.start));
    return intents;
  }

  /// "uno" → '1'; "muchos" → '1..*' (mirroring the contract's own mapping
  /// in multimodal-proposals-v1 example §9.2: "1 a muchos" → '1..*').
  static String _cardinality(String word) =>
      word.toLowerCase() == 'uno' ? '1' : '1..*';

  /// Resolves a spoken class name to a class id. Tries exact and naive
  /// Spanish singular fallbacks ("Pedidos" → "Pedido"); returns null when
  /// the name matches no known class.
  static String? _resolveClassId(Map<String, String> classIds, String name) {
    final lowered = name.toLowerCase();
    if (classIds.containsKey(lowered)) return classIds[lowered];
    if (lowered.length > 3 && lowered.endsWith('es')) {
      final singular = lowered.substring(0, lowered.length - 2);
      if (classIds.containsKey(singular)) return classIds[singular];
    }
    if (lowered.length > 2 && lowered.endsWith('s')) {
      final singular = lowered.substring(0, lowered.length - 1);
      if (classIds.containsKey(singular)) return classIds[singular];
    }
    return null;
  }

  /// Maps a nullability modifier to "required": true → multiplicity '1',
  /// false → '0..1'. Absent modifier defaults to required.
  static bool _normalizeModifier(String? modifier) {
    switch (modifier?.toLowerCase().replaceAll(RegExp(r'\s+'), ' ')) {
      case 'opcional':
      case 'nulo':
        return false;
      default:
        return true;
    }
  }

  static double _mean(Iterable<double> values) {
    final list = values.toList();
    if (list.isEmpty) return 0.0;
    final sum = list.reduce((a, b) => a + b);
    return (sum / list.length * 100).round() / 100;
  }

  ModelCommand _command(
          DomainModel model, String type, Map<String, dynamic> payload) =>
      ModelCommand(
        type: type,
        commandId: _uuid.v4(),
        modelId: model.id,
        modelVersion: model.version,
        payload: payload,
      );

  static String _uniqueId(String slug, Set<String> usedIds) {
    var candidate = slug;
    var counter = 2;
    while (usedIds.contains(candidate)) {
      candidate = '$slug-${counter++}';
    }
    usedIds.add(candidate);
    return candidate;
  }

  /// Referential integrity for `confirm_selection` (§8.1 rule 3): a selected
  /// command may not depend on an entity created by a discarded command of
  /// the same proposal.
  List<CommandDiagnostic> _findBrokenDependencies(
    MultimodalProposal proposal,
    List<ModelCommand> selected,
    DomainModel model,
  ) {
    final selectedIds = selected.map((c) => c.commandId).toSet();
    const creates = {'CreateClass', 'CreatePackage', 'CreateAssociation'};
    final discardedCreatedIds = proposal.proposedCommands
        .where((c) => !selectedIds.contains(c.commandId) && creates.contains(c.type))
        .map((c) => c.payload['id'])
        .whereType<String>()
        .toSet();

    final errors = <CommandDiagnostic>[];
    for (final c in selected) {
      final deps = <String>[
        if (c.payload['classId'] is String) c.payload['classId'] as String,
        if (c.payload['sourceClassId'] is String)
          c.payload['sourceClassId'] as String,
        if (c.payload['targetClassId'] is String)
          c.payload['targetClassId'] as String,
      ];
      for (final dep in deps) {
        if (discardedCreatedIds.contains(dep) &&
            model.classById(dep) == null &&
            model.packageById(dep) == null) {
          errors.add(CommandDiagnostic(
            code: 'INVALID_COMMAND_SELECTION',
            path: r'$.selectedCommandIds',
            message:
                "El comando '${c.commandId}' depende de la entidad '$dep' creada por un comando descartado.",
            severity: DiagnosticSeverity.error,
          ));
        }
      }
    }
    return errors;
  }
}
