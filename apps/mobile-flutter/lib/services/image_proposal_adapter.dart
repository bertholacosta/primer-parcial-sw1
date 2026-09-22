import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:uuid/uuid.dart';

import '../models/domain_model.dart';
import '../models/model_command.dart';
import '../models/multimodal_proposal.dart';
import 'model_command_processor.dart';
import 'voice_proposal_adapter.dart' show ProposalResolutionOutcome;

/// Structured interpretation of a source image, injected by whichever
/// vision engine the client integrates (multimodal-proposals-v1 §5.2).
/// The adapter performs no detection, OCR or segmentation and does not
/// choose an engine: it only converts the detections into an auditable,
/// confirmable [MultimodalProposal].
class ImageInterpretation {
  /// SHA-256 of the analyzed image (§5.2.2). When absent, the adapter
  /// hashes the canonical JSON of the interpretation itself so every
  /// proposal remains auditable (MP-INV-4).
  final String? mediaSha256;

  /// Free-text description of the capture (e.g. "foto de pizarra").
  final String? caption;

  /// UML class boxes detected in the image.
  final List<DetectedClassBox> classes;

  /// Connectors detected between class boxes.
  final List<DetectedConnector> connectors;

  const ImageInterpretation({
    this.mediaSha256,
    this.caption,
    this.classes = const [],
    this.connectors = const [],
  });

  Map<String, dynamic> toJson() => {
        if (mediaSha256 != null) 'mediaSha256': mediaSha256,
        if (caption != null) 'caption': caption,
        'classes': classes.map((c) => c.toJson()).toList(),
        'connectors': connectors.map((c) => c.toJson()).toList(),
      };
}

/// A detected UML class rectangle (§5.2.1 steps 2–3). [name] is null or
/// empty when OCR could not read the compartment header.
class DetectedClassBox {
  final String? name;
  final BoundingBox boundingBox;
  final double confidence;
  final List<DetectedAttributeLine> attributes;

  const DetectedClassBox({
    this.name,
    required this.boundingBox,
    this.confidence = 0.5,
    this.attributes = const [],
  });

  Map<String, dynamic> toJson() => {
        if (name != null) 'name': name,
        'boundingBox': boundingBox.toJson(),
        'confidence': confidence,
        'attributes': attributes.map((a) => a.toJson()).toList(),
      };
}

/// A detected attribute line inside a class box (§5.2.1 step 2). Any
/// field may be null when illegible; the adapter emits a non-blocking
/// warning for each missing value instead of fabricating one silently.
class DetectedAttributeLine {
  final String? name;
  final String? type;
  final bool? nullable;
  final String? multiplicity;
  final double confidence;
  final BoundingBox? boundingBox;

  const DetectedAttributeLine({
    this.name,
    this.type,
    this.nullable,
    this.multiplicity,
    this.confidence = 0.5,
    this.boundingBox,
  });

  Map<String, dynamic> toJson() => {
        if (name != null) 'name': name,
        if (type != null) 'type': type,
        if (nullable != null) 'nullable': nullable,
        if (multiplicity != null) 'multiplicity': multiplicity,
        'confidence': confidence,
        if (boundingBox != null) 'boundingBox': boundingBox!.toJson(),
      };
}

/// A detected connector between two class boxes (§5.2.1 step 2): arrow
/// tips map to [navigability] and numeric labels to multiplicities.
/// Endpoints are identified by the class name read on each box.
class DetectedConnector {
  final String? label;
  final String? sourceClassName;
  final String? targetClassName;
  final String? sourceMultiplicity;
  final String? targetMultiplicity;
  final String? navigability;
  final BoundingBox boundingBox;
  final double confidence;

  const DetectedConnector({
    this.label,
    this.sourceClassName,
    this.targetClassName,
    this.sourceMultiplicity,
    this.targetMultiplicity,
    this.navigability,
    required this.boundingBox,
    this.confidence = 0.5,
  });

  Map<String, dynamic> toJson() => {
        if (label != null) 'label': label,
        if (sourceClassName != null) 'sourceClassName': sourceClassName,
        if (targetClassName != null) 'targetClassName': targetClassName,
        if (sourceMultiplicity != null)
          'sourceMultiplicity': sourceMultiplicity,
        if (targetMultiplicity != null)
          'targetMultiplicity': targetMultiplicity,
        if (navigability != null) 'navigability': navigability,
        'boundingBox': boundingBox.toJson(),
        'confidence': confidence,
      };
}

/// Attribute line awaiting emission after its owning `CreateClass`.
class _PendingAttribute {
  final String classId;
  final String className;
  final DetectedAttributeLine line;
  const _PendingAttribute(this.classId, this.className, this.line);
}

/// Adapter that converts an injected structured image interpretation into
/// an auditable, confirmable [MultimodalProposal]
/// (multimodal-proposals-v1 §5.2).
///
/// The adapter deliberately performs no image capture, detection or OCR:
/// the task objective is to convert a structured interpretation that a
/// future vision engine (ADR-0005) will supply. All conversion and
/// validation is deterministic and local; no network access is required.
/// The adapter never mutates the canonical model (MP-INV-1): proposals
/// only mutate state after the deterministic dry-run gate (MP-INV-2) and
/// an explicit user confirmation (MP-INV-3).
class ImageProposalAdapter {
  ImageProposalAdapter({
    ModelCommandProcessor? processor,
    this.clientPlatform = 'android',
    this.agentRole = 'image-interpretation-adapter-v1',
    DateTime Function()? clock,
  })  : _processor = processor ?? ModelCommandProcessor(),
        _clock = clock ?? DateTime.now;

  final ModelCommandProcessor _processor;
  final String clientPlatform;
  final String agentRole;
  final DateTime Function() _clock;

  static const Uuid _uuid = Uuid();

  /// Warning code used for detections with missing or illegible fields.
  /// The affected element is either skipped or completed with a
  /// documented conservative default; never blocks the proposal.
  static const String incompleteDetectionCode = 'INCOMPLETE_DETECTION';

  /// Converts an injected [interpretation] into a confirmable proposal
  /// for [model] (§5.2). Always runs the deterministic dry-run gate
  /// before returning (MP-INV-2): VALID/WARNINGS proposals land in
  /// `awaiting_confirmation`; INVALID ones stay `dry_run_validated` for
  /// user inspection (§4, example 9.3).
  ///
  /// Commands are emitted in topological order (§3.1.4): every
  /// `CreateClass` precedes the `AddAttribute` and `CreateAssociation`
  /// commands that reference the created classes. Each proposed command
  /// is backed by a `bounding_box` evidence over the source image
  /// (§5.2.2, MP-INV-4).
  ///
  /// [ImageInterpretation.mediaSha256] should be the hash of the raw
  /// image; when absent the interpretation's own SHA-256 is used as the
  /// auditable input hash (MP-INV-4/MP-INV-5).
  MultimodalProposal propose({
    required DomainModel model,
    required ImageInterpretation interpretation,
    DateTime? capturedAt,
  }) {
    final now = _clock().toUtc();
    final mediaHash = interpretation.mediaSha256 ??
        sha256
            .convert(utf8.encode(jsonEncode(interpretation.toJson())))
            .toString();

    // name (lowercased) → classId for existing classes and classes
    // created by this same interpretation.
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
    final evidences = <ProposalEvidence>[];
    final summaryParts = <String>[];
    final proposalErrors = <CommandDiagnostic>[];
    final proposalWarnings = <CommandDiagnostic>[];
    final pendingAttributes = <_PendingAttribute>[];

    // Pass 1 — class boxes → CreateClass.
    for (var i = 0; i < interpretation.classes.length; i++) {
      final box = interpretation.classes[i];
      final name = box.name?.trim();
      evidences.add(_evidence(
        mediaHash,
        box.boundingBox,
        name == null || name.isEmpty
            ? 'Bloque de clase detectado con encabezado ilegible.'
            : "Bloque de clase con encabezado '$name'.",
      ));
      if (name == null || name.isEmpty) {
        proposalWarnings.add(_warning(
          incompleteDetectionCode,
          '\$.interpretation.classes[$i].name',
          'El bloque de clase $i no tiene un nombre legible; se omitió '
              'junto con sus ${box.attributes.length} atributos detectados.',
        ));
        continue;
      }
      final classId = _uniqueId('cls-${name.toLowerCase()}', usedIds);
      classIds[name.toLowerCase()] = classId;
      commands.add(_command(model, 'CreateClass',
          {'id': classId, 'name': name}));
      breakdown.add(ConfidenceBreakdown(
        commandIndex: commands.length - 1,
        score: _clamp01(box.confidence),
        fieldScores: {'name': _clamp01(box.confidence), 'id': 1.0},
      ));
      summaryParts.add("Crear la clase '$name'");
      for (final line in box.attributes) {
        pendingAttributes.add(_PendingAttribute(classId, name, line));
      }
    }

    // Pass 2 — attribute lines → AddAttribute.
    for (final pending in pendingAttributes) {
      final line = pending.line;
      final lineBox = line.boundingBox;
      if (lineBox != null) {
        evidences.add(_evidence(
          mediaHash,
          lineBox,
          "Línea de atributo '${line.name ?? 'ilegible'}' en la clase "
              "'${pending.className}'.",
        ));
      }
      final attrName = line.name?.trim();
      final attrType = line.type?.trim();
      if (attrName == null ||
          attrName.isEmpty ||
          attrType == null ||
          attrType.isEmpty) {
        proposalWarnings.add(_warning(
          incompleteDetectionCode,
          '\$.interpretation.classes[].attributes',
          "El atributo '${attrName ?? 'sin nombre'}' de la clase "
              "'${pending.className}' carece de nombre o tipo legible; "
              'se omitió.',
        ));
        continue;
      }
      final nullable = line.nullable ?? false;
      final multiplicity = line.multiplicity ?? '1';
      if (line.nullable == null) {
        proposalWarnings.add(_warning(
          incompleteDetectionCode,
          r'$.payload.nullable',
          "La nulabilidad de '$attrName' no fue detectada; "
              'se asumió false.',
          commandIndex: commands.length,
        ));
      }
      if (line.multiplicity == null) {
        proposalWarnings.add(_warning(
          incompleteDetectionCode,
          r'$.payload.multiplicity',
          "La multiplicidad de '$attrName' no fue detectada; "
              "se asumió '1'.",
          commandIndex: commands.length,
        ));
      }
      final attrId = _uniqueId(
        'attr-${pending.className.toLowerCase()}-${attrName.toLowerCase()}',
        usedIds,
      );
      commands.add(_command(model, 'AddAttribute', {
        'id': attrId,
        'classId': pending.classId,
        'name': attrName,
        'type': attrType,
        'nullable': nullable,
        'multiplicity': multiplicity,
      }));
      final knownType = DomainModel.allowedTypes.contains(attrType);
      final conf = _clamp01(line.confidence);
      final fieldScores = <String, double>{
        'name': conf,
        'type': knownType ? conf : 0.50,
        'nullable': line.nullable != null ? conf : 0.60,
        'multiplicity': line.multiplicity != null ? conf : 0.60,
      };
      breakdown.add(ConfidenceBreakdown(
        commandIndex: commands.length - 1,
        score: _mean(fieldScores.values),
        fieldScores: fieldScores,
      ));
      summaryParts.add(
        "Agregar el atributo '$attrName' de tipo '$attrType' "
        "a la clase '${pending.className}'",
      );
    }

    // Pass 3 — connectors → CreateAssociation.
    for (var i = 0; i < interpretation.connectors.length; i++) {
      final conn = interpretation.connectors[i];
      final source = conn.sourceClassName?.trim();
      final target = conn.targetClassName?.trim();
      evidences.add(_evidence(
        mediaHash,
        conn.boundingBox,
        "Conector detectado de '${source ?? 'origen ilegible'}' a "
            "'${target ?? 'destino ilegible'}'.",
      ));
      if (source == null ||
          source.isEmpty ||
          target == null ||
          target.isEmpty) {
        proposalWarnings.add(_warning(
          incompleteDetectionCode,
          '\$.interpretation.connectors[$i]',
          'El conector $i no tiene extremos legibles; se omitió.',
        ));
        continue;
      }
      final sourceId = _resolveClassId(classIds, source);
      final targetId = _resolveClassId(classIds, target);
      final sourceMult = conn.sourceMultiplicity ?? '1';
      final targetMult = conn.targetMultiplicity ?? '1';
      final navigability = conn.navigability ?? 'unidirectional';
      if (conn.sourceMultiplicity == null) {
        proposalWarnings.add(_warning(
          incompleteDetectionCode,
          r'$.payload.sourceMultiplicity',
          "La multiplicidad del extremo '$source' no fue detectada; "
              "se asumió '1'.",
          commandIndex: commands.length,
        ));
      }
      if (conn.targetMultiplicity == null) {
        proposalWarnings.add(_warning(
          incompleteDetectionCode,
          r'$.payload.targetMultiplicity',
          "La multiplicidad del extremo '$target' no fue detectada; "
              "se asumió '1'.",
          commandIndex: commands.length,
        ));
      }
      if (conn.navigability == null) {
        proposalWarnings.add(_warning(
          incompleteDetectionCode,
          r'$.payload.navigability',
          'La navegabilidad del conector no fue detectada; '
              'se asumió unidirectional.',
          commandIndex: commands.length,
        ));
      }
      final label = conn.label?.trim();
      commands.add(_command(model, 'CreateAssociation', {
        'id': _uniqueId(
          'assoc-${source.toLowerCase()}-${target.toLowerCase()}',
          usedIds,
        ),
        if (label != null && label.isNotEmpty) 'name': label,
        'sourceClassId': sourceId ?? 'cls-${source.toLowerCase()}',
        'targetClassId': targetId ?? 'cls-${target.toLowerCase()}',
        'sourceMultiplicity': sourceMult,
        'targetMultiplicity': targetMult,
        'navigability': navigability,
      }));
      final conf = _clamp01(conn.confidence);
      final fieldScores = <String, double>{
        'sourceClassId': sourceId != null ? conf : 0.55,
        'targetClassId': targetId != null ? conf : 0.55,
        'sourceMultiplicity': conn.sourceMultiplicity != null ? conf : 0.60,
        'targetMultiplicity': conn.targetMultiplicity != null ? conf : 0.60,
        'navigability': conn.navigability != null ? conf : 0.65,
      };
      breakdown.add(ConfidenceBreakdown(
        commandIndex: commands.length - 1,
        score: _mean(fieldScores.values),
        fieldScores: fieldScores,
      ));
      summaryParts.add(
        "Asociar '$source' con '$target' ($sourceMult a $targetMult)",
      );
    }

    if (interpretation.classes.isEmpty && interpretation.connectors.isEmpty) {
      proposalErrors.add(const CommandDiagnostic(
        code: 'INTENT_UNRECOGNIZED',
        path: r'$.interpretation',
        message: 'La interpretación de la imagen no contiene clases ni '
            'conectores reconocibles como elementos UML.',
        severity: DiagnosticSeverity.error,
      ));
    } else if (commands.isEmpty) {
      proposalErrors.add(const CommandDiagnostic(
        code: 'NO_COMMANDS_GENERATED',
        path: r'$.proposedCommands',
        message: 'La interpretación fue procesada pero no se pudo deducir '
            'ningún comando válido para el metamodelo v1.',
        severity: DiagnosticSeverity.error,
      ));
    }

    final overall =
        breakdown.isEmpty ? 0.0 : _mean(breakdown.map((b) => b.score));
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
      final allWarnings = [...proposalWarnings, ...result.warnings];
      dryRun = DryRunValidation(
        status: allErrors.isNotEmpty
            ? DryRunStatus.invalid
            : (allWarnings.isNotEmpty
                ? DryRunStatus.warnings
                : DryRunStatus.valid),
        validatedAt: now,
        errors: allErrors,
        warnings: allWarnings,
      );
    } else {
      dryRun = DryRunValidation(
        status: DryRunStatus.invalid,
        validatedAt: now,
        errors: proposalErrors,
        warnings: proposalWarnings,
      );
    }

    return MultimodalProposal(
      proposalId: _uuid.v4(),
      modelId: model.id,
      targetModelVersion: model.version,
      createdAt: now,
      lifecycleState: dryRun.status == DryRunStatus.invalid
          ? ProposalLifecycleState.dryRunValidated
          : ProposalLifecycleState.awaitingConfirmation,
      source: ProposalSource(
        modality: ProposalModality.image,
        clientPlatform: clientPlatform,
        agentRole: agentRole,
        capturedAt: (capturedAt ?? now).toUtc(),
      ),
      confidence: ProposalConfidence(
        overall: overall,
        level: overall >= 0.85
            ? ConfidenceLevel.high
            : (overall >= 0.60
                ? ConfidenceLevel.medium
                : ConfidenceLevel.low),
        breakdown: breakdown,
      ),
      evidences: evidences,
      intent: ProposalIntent(
        summary: summaryParts.isEmpty
            ? 'Sin elementos de modelado detectados en la imagen.'
            : summaryParts.join('; '),
        rawPrompt: interpretation.caption ??
            'Interpretación de imagen inyectada; el motor de visión aún '
                'no está seleccionado.',
      ),
      proposedCommands: commands,
      dryRunValidation: dryRun,
    );
  }

  /// Confirms a proposal and dispatches its commands atomically
  /// (§8.1). Confirmation is refused unless the proposal passed the
  /// deterministic dry-run (`VALID`/`WARNINGS`) and the model version
  /// still matches. Returns the updated proposal; [model] is mutated
  /// only when every selected command is accepted.
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

  // ---- Helpers -----------------------------------------------------------

  ProposalEvidence _evidence(
          String mediaHash, BoundingBox box, String description) =>
      ProposalEvidence(
        evidenceId: _uuid.v4(),
        type: EvidenceType.boundingBox,
        mediaSha256: mediaHash,
        payload: EvidencePayload(
          boundingBox: box,
          description: description,
        ),
      );

  CommandDiagnostic _warning(String code, String path, String message,
          {int? commandIndex}) =>
      CommandDiagnostic(
        code: code,
        path: path,
        message: message,
        severity: DiagnosticSeverity.warning,
        commandIndex: commandIndex,
      );

  /// Resolves a detected class name to a class id. Tries exact and naive
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

  static double _clamp01(double value) => value.clamp(0.0, 1.0).toDouble();

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

  /// Referential integrity for `confirm_selection` (§8.1 rule 3): a
  /// selected command may not depend on an entity created by a discarded
  /// command of the same proposal.
  List<CommandDiagnostic> _findBrokenDependencies(
    MultimodalProposal proposal,
    List<ModelCommand> selected,
    DomainModel model,
  ) {
    final selectedIds = selected.map((c) => c.commandId).toSet();
    const creates = {'CreateClass', 'CreatePackage', 'CreateAssociation'};
    final discardedCreatedIds = proposal.proposedCommands
        .where(
            (c) => !selectedIds.contains(c.commandId) && creates.contains(c.type))
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
