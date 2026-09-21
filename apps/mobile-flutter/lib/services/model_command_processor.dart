import 'dart:convert';

import '../models/domain_model.dart';
import '../models/model_command.dart';

/// Result of a deterministic dry-run of an ordered command batch
/// (multimodal-proposals-v1 §3.1.5 `dryRunValidation`).
class DryRunResult {
  /// 'VALID' | 'WARNINGS' | 'INVALID'
  final String validationStatus;
  final List<CommandDiagnostic> errors;
  final List<CommandDiagnostic> warnings;

  const DryRunResult({
    required this.validationStatus,
    this.errors = const [],
    this.warnings = const [],
  });
}

/// Result of the atomic dispatch of a confirmed command batch
/// (multimodal-proposals-v1 §8.1 rules 4–6).
class BatchApplyResult {
  final bool applied;
  final String modelVersion;
  final List<CommandDiagnostic> errors;
  final List<CommandDiagnostic> warnings;

  const BatchApplyResult({
    required this.applied,
    required this.modelVersion,
    this.errors = const [],
    this.warnings = const [],
  });
}

/// Deterministic processor of model-commands-v1.
///
/// Evaluates preconditions in the order fixed by §9 so diagnostics are
/// reproducible. Commands never mutate the model when rejected (§2.3,
/// decision D1). Used by the multimodal proposal adapter as the mandatory
/// deterministic gate (multimodal-proposals-v1 MP-INV-2).
class ModelCommandProcessor {
  /// Idempotency log (model-commands-v1 §2.1): fingerprints of commands
  /// already applied through this processor instance.
  final Set<String> _appliedFingerprints = {};

  /// Executes a single command against [model], mutating it on `accepted`.
  ///
  /// Re-sending a `commandId` with an identical payload yields `noop`
  /// (model-commands-v1 §2.1).
  CommandResult execute(DomainModel model, ModelCommand command) {
    final fingerprint = _fingerprint(command);
    if (_appliedFingerprints.contains(fingerprint)) {
      return CommandResult(
        commandId: command.commandId,
        result: CommandResultStatus.noop,
        modelVersion: model.version,
      );
    }
    final errors = <CommandDiagnostic>[];
    final warnings = <CommandDiagnostic>[];
    final status =
        _applyChecked(model, command, model.version, errors, warnings);
    if (status == CommandResultStatus.accepted) {
      _appliedFingerprints.add(fingerprint);
    }
    return CommandResult(
      commandId: command.commandId,
      result: status,
      modelVersion: model.version,
      errors: errors,
      warnings: warnings,
    );
  }

  /// Simulates the ordered [commands] against a clone of [model]
  /// (multimodal-proposals-v1 MP-INV-2). [model] is never mutated.
  ///
  /// Concurrency is checked at batch level: every command must declare the
  /// model version captured when the batch starts (`modelVersion` ==
  /// `model.version`), matching the proposal's `targetModelVersion`.
  DryRunResult dryRun(DomainModel model, List<ModelCommand> commands) {
    final sim = model.clone();
    final baseVersion = sim.version;
    final errors = <CommandDiagnostic>[];
    final warnings = <CommandDiagnostic>[];
    for (var i = 0; i < commands.length; i++) {
      final cmdErrors = <CommandDiagnostic>[];
      final cmdWarnings = <CommandDiagnostic>[];
      _applyChecked(sim, commands[i], baseVersion, cmdErrors, cmdWarnings);
      errors.addAll(cmdErrors.map((d) => d.atIndex(i)));
      warnings.addAll(cmdWarnings.map((d) => d.atIndex(i)));
    }
    final status = errors.isNotEmpty
        ? 'INVALID'
        : (warnings.isNotEmpty ? 'WARNINGS' : 'VALID');
    return DryRunResult(
      validationStatus: status,
      errors: errors,
      warnings: warnings,
    );
  }

  /// Atomically applies the ordered [commands] to [model]
  /// (multimodal-proposals-v1 §8.1 rule 6): if any command is rejected, no
  /// change is persisted.
  BatchApplyResult applyBatch(DomainModel model, List<ModelCommand> commands) {
    final sim = model.clone();
    final baseVersion = sim.version;
    final errors = <CommandDiagnostic>[];
    final warnings = <CommandDiagnostic>[];
    var allApplied = true;
    for (var i = 0; i < commands.length; i++) {
      final cmdErrors = <CommandDiagnostic>[];
      final cmdWarnings = <CommandDiagnostic>[];
      final status = _applyChecked(
          sim, commands[i], baseVersion, cmdErrors, cmdWarnings);
      if (status == CommandResultStatus.rejected) allApplied = false;
      errors.addAll(cmdErrors.map((d) => d.atIndex(i)));
      warnings.addAll(cmdWarnings.map((d) => d.atIndex(i)));
    }
    if (allApplied) {
      model.copyFrom(sim);
      for (final c in commands) {
        _appliedFingerprints.add(_fingerprint(c));
      }
    }
    return BatchApplyResult(
      applied: allApplied,
      modelVersion: model.version,
      errors: errors,
      warnings: warnings,
    );
  }

  String _fingerprint(ModelCommand c) =>
      '${c.commandId}|${jsonEncode(c.payload)}';

  /// Evaluates [cmd]'s preconditions (§9 order) and applies it when valid.
  /// [baseVersion] is the version the batch/concurrency check is bound to.
  CommandResultStatus _applyChecked(
    DomainModel model,
    ModelCommand cmd,
    String baseVersion,
    List<CommandDiagnostic> errors,
    List<CommandDiagnostic> warnings,
  ) {
    // §9 step 1: model existence — short-circuits all other checks.
    if (cmd.modelId != model.id) {
      errors.add(_error('MODEL_NOT_FOUND', r'$.modelId',
          "El modelo '${cmd.modelId}' no existe en el repositorio."));
      return CommandResultStatus.rejected;
    }
    // §9 step 2: optimistic concurrency.
    if (cmd.modelVersion != baseVersion) {
      errors.add(_error('CONCURRENT_MODIFICATION', r'$.modelVersion',
          "El comando declara modelVersion '${cmd.modelVersion}' pero la versión base es '$baseVersion'."));
    }

    switch (cmd.type) {
      case 'CreateClass':
        _checkCreateClass(model, cmd, errors);
      case 'RenameClass':
        _checkRenameClass(model, cmd, errors);
      case 'DeleteClass':
        _checkDeleteClass(model, cmd, errors);
      case 'AddAttribute':
        _checkAddAttribute(model, cmd, errors);
      case 'UpdateAttribute':
        _checkUpdateAttribute(model, cmd, errors);
      case 'DeleteAttribute':
        _checkDeleteAttribute(model, cmd, errors);
      case 'CreateAssociation':
        _checkCreateAssociation(model, cmd, errors);
      case 'UpdateAssociation':
        _checkUpdateAssociation(model, cmd, errors);
      case 'DeleteAssociation':
        _checkDeleteAssociation(model, cmd, errors);
      case 'CreatePackage':
        _checkCreatePackage(model, cmd, errors);
      case 'DeletePackage':
        _checkDeletePackage(model, cmd, errors);
      default:
        errors.add(_error('PROPOSED_COMMAND_SYNTAX_ERROR', r'$.type',
            "Tipo de comando '${cmd.type}' no reconocido por model-commands-v1."));
    }

    if (errors.isNotEmpty) return CommandResultStatus.rejected;
    return _mutate(model, cmd, warnings);
  }

  // ---- Payload helpers -------------------------------------------------

  static String? _optStr(Map<String, dynamic> p, String field) =>
      p[field] is String ? p[field] as String : null;

  String? _reqStr(
      Map<String, dynamic> p, String field, List<CommandDiagnostic> errors) {
    final value = _optStr(p, field);
    if (value == null) {
      errors.add(_error('PROPOSED_COMMAND_SYNTAX_ERROR', '\$.payload.$field',
          "El campo obligatorio '$field' falta o no es una cadena."));
    }
    return value;
  }

  bool? _reqBool(
      Map<String, dynamic> p, String field, List<CommandDiagnostic> errors) {
    final value = p[field];
    if (value is! bool) {
      errors.add(_error('PROPOSED_COMMAND_SYNTAX_ERROR', '\$.payload.$field',
          "El campo obligatorio '$field' falta o no es booleano."));
      return null;
    }
    return value;
  }

  CommandDiagnostic _error(String code, String path, String message) =>
      CommandDiagnostic(
          code: code,
          path: path,
          message: message,
          severity: DiagnosticSeverity.error);

  CommandDiagnostic _warning(String code, String path, String message) =>
      CommandDiagnostic(
          code: code,
          path: path,
          message: message,
          severity: DiagnosticSeverity.warning);

  // ---- Precondition checkers (§9 order: existence, id uniqueness, name
  // uniqueness, name format, enum values, structural rules) ---------------

  void _checkCreateClass(
      DomainModel m, ModelCommand cmd, List<CommandDiagnostic> errors) {
    final p = cmd.payload;
    final id = _reqStr(p, 'id', errors);
    final name = _reqStr(p, 'name', errors);
    final packageId = _optStr(p, 'packageId');

    if (packageId != null && m.packageById(packageId) == null) {
      errors.add(_error('PACKAGE_NOT_FOUND', r'$.payload.packageId',
          "No existe un paquete con id '$packageId'."));
    }
    if (id != null && m.classes.any((c) => c.id == id)) {
      errors.add(_error('DUPLICATE_ID', r'$.payload.id',
          "Ya existe una clase con id '$id'."));
    }
    if (name != null) {
      if (m.classes.any((c) => c.name == name && c.packageId == packageId)) {
        errors.add(_error('DUPLICATE_CLASS_NAME', r'$.payload.name',
            "Ya existe una clase con nombre '$name' en el mismo paquete."));
      }
      if (!DomainModel.namePattern.hasMatch(name)) {
        errors.add(_error('INVALID_NAME_FORMAT', r'$.payload.name',
            "El nombre '$name' no satisface el patrón [A-Za-z_][A-Za-z0-9_]*."));
      }
    }
  }

  void _checkRenameClass(
      DomainModel m, ModelCommand cmd, List<CommandDiagnostic> errors) {
    final p = cmd.payload;
    final classId = _reqStr(p, 'classId', errors);
    final newName = _reqStr(p, 'newName', errors);

    DomainClass? target;
    if (classId != null) {
      target = m.classById(classId);
      if (target == null) {
        errors.add(_error('CLASS_NOT_FOUND', r'$.payload.classId',
            "No existe una clase con id '$classId'."));
      }
    }
    if (newName != null) {
      if (m.classes.any((c) =>
          c.id != classId &&
          c.name == newName &&
          c.packageId == target?.packageId)) {
        errors.add(_error('DUPLICATE_CLASS_NAME', r'$.payload.newName',
            "Ya existe una clase con nombre '$newName' en el mismo paquete."));
      }
      if (!DomainModel.namePattern.hasMatch(newName)) {
        errors.add(_error('INVALID_NAME_FORMAT', r'$.payload.newName',
            "El nombre '$newName' no satisface el patrón [A-Za-z_][A-Za-z0-9_]*."));
      }
    }
  }

  void _checkDeleteClass(
      DomainModel m, ModelCommand cmd, List<CommandDiagnostic> errors) {
    final classId = _reqStr(cmd.payload, 'classId', errors);
    if (classId != null && m.classById(classId) == null) {
      errors.add(_error('CLASS_NOT_FOUND', r'$.payload.classId',
          "No existe una clase con id '$classId'."));
    }
  }

  void _checkAddAttribute(
      DomainModel m, ModelCommand cmd, List<CommandDiagnostic> errors) {
    final p = cmd.payload;
    final id = _reqStr(p, 'id', errors);
    final classId = _reqStr(p, 'classId', errors);
    final name = _reqStr(p, 'name', errors);
    final type = _reqStr(p, 'type', errors);
    _reqBool(p, 'nullable', errors);
    final multiplicity = _reqStr(p, 'multiplicity', errors);

    DomainClass? target;
    if (classId != null) {
      target = m.classById(classId);
      if (target == null) {
        errors.add(_error('CLASS_NOT_FOUND', r'$.payload.classId',
            "No existe una clase con id '$classId'."));
      }
    }
    if (id != null && m.attributeIdExists(id)) {
      errors.add(_error('DUPLICATE_ID', r'$.payload.id',
          "Ya existe un atributo con id '$id' en el documento."));
    }
    if (name != null) {
      if (target != null && target.hasAttributeNamed(name)) {
        errors.add(_error('DUPLICATE_ATTRIBUTE_NAME', r'$.payload.name',
            "Ya existe un atributo con nombre '$name' en la clase '${target.name}'."));
      }
      if (!DomainModel.namePattern.hasMatch(name)) {
        errors.add(_error('INVALID_NAME_FORMAT', r'$.payload.name',
            "El nombre '$name' no satisface el patrón [A-Za-z_][A-Za-z0-9_]*."));
      }
    }
    if (type != null && !DomainModel.allowedTypes.contains(type)) {
      errors.add(_error('UNKNOWN_TYPE', r'$.payload.type',
          "Tipo '$type' no reconocido en el corte mínimo v1. Tipos permitidos: ${DomainModel.allowedTypes.join(', ')}."));
    }
    if (multiplicity != null &&
        !DomainModel.allowedMultiplicities.contains(multiplicity)) {
      errors.add(_error('INVALID_MULTIPLICITY', r'$.payload.multiplicity',
          "La multiplicidad '$multiplicity' no es un literal permitido."));
    }
  }

  void _checkUpdateAttribute(
      DomainModel m, ModelCommand cmd, List<CommandDiagnostic> errors) {
    final p = cmd.payload;
    final attributeId = _reqStr(p, 'attributeId', errors);
    final classId = _reqStr(p, 'classId', errors);

    DomainClass? target;
    DomainAttribute? attribute;
    if (classId != null) {
      target = m.classById(classId);
      if (target == null) {
        errors.add(_error('CLASS_NOT_FOUND', r'$.payload.classId',
            "No existe una clase con id '$classId'."));
      }
    }
    if (target != null && attributeId != null) {
      attribute = target.attributeById(attributeId);
      if (attribute == null) {
        errors.add(_error('ATTRIBUTE_NOT_FOUND', r'$.payload.attributeId',
            "No existe un atributo con id '$attributeId' en la clase '${target.name}'."));
      }
    }
    final newName = _optStr(p, 'name');
    if (newName != null) {
      if (target != null &&
          target.hasAttributeNamed(newName, excludeId: attributeId)) {
        errors.add(_error('DUPLICATE_ATTRIBUTE_NAME', r'$.payload.name',
            "Ya existe un atributo con nombre '$newName' en la clase '${target.name}'."));
      }
      if (!DomainModel.namePattern.hasMatch(newName)) {
        errors.add(_error('INVALID_NAME_FORMAT', r'$.payload.name',
            "El nombre '$newName' no satisface el patrón [A-Za-z_][A-Za-z0-9_]*."));
      }
    }
    final newType = _optStr(p, 'type');
    if (newType != null && !DomainModel.allowedTypes.contains(newType)) {
      errors.add(_error('UNKNOWN_TYPE', r'$.payload.type',
          "Tipo '$newType' no reconocido en el corte mínimo v1."));
    }
    final newMult = _optStr(p, 'multiplicity');
    if (newMult != null &&
        !DomainModel.allowedMultiplicities.contains(newMult)) {
      errors.add(_error('INVALID_MULTIPLICITY', r'$.payload.multiplicity',
          "La multiplicidad '$newMult' no es un literal permitido."));
    }
    if (p.containsKey('nullable') && p['nullable'] is! bool) {
      errors.add(_error('PROPOSED_COMMAND_SYNTAX_ERROR', r'$.payload.nullable',
          "El campo 'nullable' debe ser booleano."));
    }
  }

  void _checkDeleteAttribute(
      DomainModel m, ModelCommand cmd, List<CommandDiagnostic> errors) {
    final p = cmd.payload;
    final attributeId = _reqStr(p, 'attributeId', errors);
    final classId = _reqStr(p, 'classId', errors);

    DomainClass? target;
    if (classId != null) {
      target = m.classById(classId);
      if (target == null) {
        errors.add(_error('CLASS_NOT_FOUND', r'$.payload.classId',
            "No existe una clase con id '$classId'."));
      }
    }
    if (target != null &&
        attributeId != null &&
        target.attributeById(attributeId) == null) {
      errors.add(_error('ATTRIBUTE_NOT_FOUND', r'$.payload.attributeId',
          "No existe un atributo con id '$attributeId' en la clase '${target.name}'."));
    }
  }

  void _checkCreateAssociation(
      DomainModel m, ModelCommand cmd, List<CommandDiagnostic> errors) {
    final p = cmd.payload;
    final id = _reqStr(p, 'id', errors);
    final sourceClassId = _reqStr(p, 'sourceClassId', errors);
    final targetClassId = _reqStr(p, 'targetClassId', errors);
    final sourceMult = _reqStr(p, 'sourceMultiplicity', errors);
    final targetMult = _reqStr(p, 'targetMultiplicity', errors);
    final navigability = _reqStr(p, 'navigability', errors);

    if (sourceClassId != null && m.classById(sourceClassId) == null) {
      errors.add(_error('CLASS_NOT_FOUND', r'$.payload.sourceClassId',
          "No existe una clase con id '$sourceClassId' (extremo origen)."));
    }
    if (targetClassId != null && m.classById(targetClassId) == null) {
      errors.add(_error('CLASS_NOT_FOUND', r'$.payload.targetClassId',
          "No existe una clase con id '$targetClassId' (extremo destino)."));
    }
    if (id != null && m.associations.any((a) => a.id == id)) {
      errors.add(_error('DUPLICATE_ID', r'$.payload.id',
          "Ya existe una asociación con id '$id'."));
    }
    if (sourceMult != null &&
        !DomainModel.allowedMultiplicities.contains(sourceMult)) {
      errors.add(_error('INVALID_MULTIPLICITY', r'$.payload.sourceMultiplicity',
          "La multiplicidad '$sourceMult' no es un literal permitido."));
    }
    if (targetMult != null &&
        !DomainModel.allowedMultiplicities.contains(targetMult)) {
      errors.add(_error('INVALID_MULTIPLICITY', r'$.payload.targetMultiplicity',
          "La multiplicidad '$targetMult' no es un literal permitido."));
    }
    if (navigability != null &&
        !DomainModel.allowedNavigabilities.contains(navigability)) {
      errors.add(_error('INVALID_NAVIGABILITY', r'$.payload.navigability',
          "La navegabilidad '$navigability' debe ser 'unidirectional' o 'bidirectional'."));
    }
    if (sourceClassId != null &&
        targetClassId != null &&
        sourceClassId == targetClassId) {
      errors.add(_error('SELF_ASSOCIATION_NOT_ALLOWED',
          r'$.payload.targetClassId',
          "sourceClassId y targetClassId no pueden ser el mismo en v1. La clase '$sourceClassId' no puede asociarse consigo misma."));
    }
  }

  void _checkUpdateAssociation(
      DomainModel m, ModelCommand cmd, List<CommandDiagnostic> errors) {
    final p = cmd.payload;
    final associationId = _reqStr(p, 'associationId', errors);
    if (associationId != null && m.associationById(associationId) == null) {
      errors.add(_error('ASSOCIATION_NOT_FOUND', r'$.payload.associationId',
          "No existe una asociación con id '$associationId'."));
    }
    final sourceMult = _optStr(p, 'sourceMultiplicity');
    if (sourceMult != null &&
        !DomainModel.allowedMultiplicities.contains(sourceMult)) {
      errors.add(_error('INVALID_MULTIPLICITY', r'$.payload.sourceMultiplicity',
          "La multiplicidad '$sourceMult' no es un literal permitido."));
    }
    final targetMult = _optStr(p, 'targetMultiplicity');
    if (targetMult != null &&
        !DomainModel.allowedMultiplicities.contains(targetMult)) {
      errors.add(_error('INVALID_MULTIPLICITY', r'$.payload.targetMultiplicity',
          "La multiplicidad '$targetMult' no es un literal permitido."));
    }
    final navigability = _optStr(p, 'navigability');
    if (navigability != null &&
        !DomainModel.allowedNavigabilities.contains(navigability)) {
      errors.add(_error('INVALID_NAVIGABILITY', r'$.payload.navigability',
          "La navegabilidad '$navigability' debe ser 'unidirectional' o 'bidirectional'."));
    }
  }

  void _checkDeleteAssociation(
      DomainModel m, ModelCommand cmd, List<CommandDiagnostic> errors) {
    final associationId =
        _reqStr(cmd.payload, 'associationId', errors);
    if (associationId != null &&
        m.associationById(associationId) == null) {
      errors.add(_error('ASSOCIATION_NOT_FOUND', r'$.payload.associationId',
          "No existe una asociación con id '$associationId'."));
    }
  }

  void _checkCreatePackage(
      DomainModel m, ModelCommand cmd, List<CommandDiagnostic> errors) {
    final p = cmd.payload;
    final id = _reqStr(p, 'id', errors);
    final name = _reqStr(p, 'name', errors);
    final parentId = _optStr(p, 'parentId');

    if (parentId != null && m.packageById(parentId) == null) {
      errors.add(_error('PACKAGE_NOT_FOUND', r'$.payload.parentId',
          "No existe un paquete con id '$parentId'."));
    }
    if (id != null && m.packages.any((pk) => pk.id == id)) {
      errors.add(_error('DUPLICATE_ID', r'$.payload.id',
          "Ya existe un paquete con id '$id'."));
    }
    if (name != null) {
      if (m.packages
          .any((pk) => pk.name == name && pk.parentId == parentId)) {
        errors.add(_error('DUPLICATE_PACKAGE_NAME', r'$.payload.name',
            "Ya existe un paquete con nombre '$name' bajo el mismo padre."));
      }
      if (!DomainModel.namePattern.hasMatch(name)) {
        errors.add(_error('INVALID_NAME_FORMAT', r'$.payload.name',
            "El nombre '$name' no satisface el patrón [A-Za-z_][A-Za-z0-9_]*."));
      }
    }
  }

  void _checkDeletePackage(
      DomainModel m, ModelCommand cmd, List<CommandDiagnostic> errors) {
    final packageId = _reqStr(cmd.payload, 'packageId', errors);
    if (packageId == null) return;
    if (m.packageById(packageId) == null) {
      errors.add(_error('PACKAGE_NOT_FOUND', r'$.payload.packageId',
          "No existe un paquete con id '$packageId'."));
    }
    if (m.classes.any((c) => c.packageId == packageId)) {
      errors.add(_error('PACKAGE_NOT_EMPTY', r'$.payload.packageId',
          "El paquete '$packageId' contiene clases y no puede eliminarse."));
    }
    if (m.packages.any((pk) => pk.parentId == packageId)) {
      errors.add(_error('PACKAGE_HAS_CHILDREN', r'$.payload.packageId',
          "El paquete '$packageId' contiene subpaquetes."));
    }
  }

  // ---- Mutation (only invoked when every precondition passed) -----------

  CommandResultStatus _mutate(DomainModel model, ModelCommand cmd,
      List<CommandDiagnostic> warnings) {
    final p = cmd.payload;
    switch (cmd.type) {
      case 'CreateClass':
        model.classes.add(DomainClass(
          id: p['id'] as String,
          name: p['name'] as String,
          packageId: p['packageId'] as String?,
          isAbstract: p['isAbstract'] as bool? ?? false,
          description: p['description'] as String?,
        ));
        model.bumpPatch();
        return CommandResultStatus.accepted;

      case 'RenameClass':
        model.classById(p['classId'] as String)!.name =
            p['newName'] as String;
        model.bumpPatch();
        return CommandResultStatus.accepted;

      case 'DeleteClass':
        final classId = p['classId'] as String;
        model.classes.removeWhere((c) => c.id == classId);
        // Cascading association removal (§3.3 decision D3).
        model.associations.removeWhere(
            (a) => a.sourceClassId == classId || a.targetClassId == classId);
        model.bumpPatch();
        return CommandResultStatus.accepted;

      case 'AddAttribute':
        final target = model.classById(p['classId'] as String)!;
        target.attributes.add(DomainAttribute(
          id: p['id'] as String,
          name: p['name'] as String,
          type: p['type'] as String,
          nullable: p['nullable'] as bool,
          multiplicity: p['multiplicity'] as String,
          description: p['description'] as String?,
        ));
        model.bumpPatch();
        _semanticWarnings(p['multiplicity'] as String,
            p['nullable'] as bool, warnings);
        return CommandResultStatus.accepted;

      case 'UpdateAttribute':
        final target = model.classById(p['classId'] as String)!;
        final attribute = target.attributeById(p['attributeId'] as String)!;
        const modifiable = {
          'name',
          'type',
          'nullable',
          'multiplicity',
          'description',
        };
        if (!p.keys.any(modifiable.contains)) {
          return CommandResultStatus.noop;
        }
        if (p['name'] is String) attribute.name = p['name'] as String;
        if (p['type'] is String) attribute.type = p['type'] as String;
        if (p['nullable'] is bool) attribute.nullable = p['nullable'] as bool;
        if (p['multiplicity'] is String) {
          attribute.multiplicity = p['multiplicity'] as String;
        }
        if (p.containsKey('description')) {
          attribute.description = p['description'] as String?;
        }
        model.bumpPatch();
        _semanticWarnings(attribute.multiplicity, attribute.nullable, warnings);
        return CommandResultStatus.accepted;

      case 'DeleteAttribute':
        final target = model.classById(p['classId'] as String)!;
        target.attributes
            .removeWhere((a) => a.id == p['attributeId'] as String);
        model.bumpPatch();
        return CommandResultStatus.accepted;

      case 'CreateAssociation':
        model.associations.add(DomainAssociation(
          id: p['id'] as String,
          name: p['name'] as String?,
          sourceClassId: p['sourceClassId'] as String,
          targetClassId: p['targetClassId'] as String,
          sourceMultiplicity: p['sourceMultiplicity'] as String,
          targetMultiplicity: p['targetMultiplicity'] as String,
          navigability: p['navigability'] as String,
          description: p['description'] as String?,
        ));
        model.bumpPatch();
        return CommandResultStatus.accepted;

      case 'UpdateAssociation':
        final assoc =
            model.associationById(p['associationId'] as String)!;
        const modifiable = {
          'name',
          'sourceMultiplicity',
          'targetMultiplicity',
          'navigability',
          'description',
        };
        if (!p.keys.any(modifiable.contains)) {
          return CommandResultStatus.noop;
        }
        if (p['name'] is String) assoc.name = p['name'] as String;
        if (p['sourceMultiplicity'] is String) {
          assoc.sourceMultiplicity = p['sourceMultiplicity'] as String;
        }
        if (p['targetMultiplicity'] is String) {
          assoc.targetMultiplicity = p['targetMultiplicity'] as String;
        }
        if (p['navigability'] is String) {
          assoc.navigability = p['navigability'] as String;
        }
        if (p.containsKey('description')) {
          assoc.description = p['description'] as String?;
        }
        model.bumpPatch();
        return CommandResultStatus.accepted;

      case 'DeleteAssociation':
        model.associations
            .removeWhere((a) => a.id == p['associationId'] as String);
        model.bumpPatch();
        return CommandResultStatus.accepted;

      case 'CreatePackage':
        model.packages.add(DomainPackage(
          id: p['id'] as String,
          name: p['name'] as String,
          parentId: p['parentId'] as String?,
          description: p['description'] as String?,
        ));
        model.bumpPatch();
        return CommandResultStatus.accepted;

      case 'DeletePackage':
        model.packages.removeWhere((pk) => pk.id == p['packageId'] as String);
        model.bumpPatch();
        return CommandResultStatus.accepted;

      default:
        return CommandResultStatus.rejected;
    }
  }

  /// Semantic warnings of domain-model-v1 §3.6, emitted only after every
  /// blocking precondition passed (model-commands-v1 §9 step 9).
  void _semanticWarnings(
      String multiplicity, bool nullable, List<CommandDiagnostic> warnings) {
    if (multiplicity == '1' && nullable) {
      warnings.add(_warning('NULLABLE_REQUIRED_CONFLICT', r'$.payload',
          "El atributo tiene multiplicity '1' pero nullable es true."));
    }
    if (multiplicity == '0..1' && !nullable) {
      warnings.add(_warning('NOT_NULLABLE_OPTIONAL_CONFLICT', r'$.payload',
          "El atributo tiene multiplicity '0..1' pero nullable es false."));
    }
  }
}
