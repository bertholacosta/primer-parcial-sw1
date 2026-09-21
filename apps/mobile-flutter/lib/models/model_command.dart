/// Command envelope and diagnostics of the model-commands-v1 contract (§2.1,
/// §8) shared by the deterministic processor and the multimodal proposal
/// dry-run report (multimodal-proposals-v1 §3.1.5).
library;

/// Severity of a diagnostic (model-commands-v1 §8).
enum DiagnosticSeverity {
  error('ERROR'),
  warning('WARNING');

  const DiagnosticSeverity(this.wireName);
  final String wireName;
}

/// A single diagnostic emitted by the deterministic command processor.
///
/// [commandIndex] is populated when the diagnostic belongs to an ordered
/// batch (multimodal-proposals-v1 §3.1.5 `dryRunValidation`).
class CommandDiagnostic {
  final String code;
  final String path;
  final String message;
  final DiagnosticSeverity severity;
  final int? commandIndex;

  const CommandDiagnostic({
    required this.code,
    required this.path,
    required this.message,
    required this.severity,
    this.commandIndex,
  });

  /// Returns a copy bound to [index] within a command batch.
  CommandDiagnostic atIndex(int index) => CommandDiagnostic(
        code: code,
        path: path,
        message: message,
        severity: severity,
        commandIndex: index,
      );

  Map<String, dynamic> toJson() => {
        if (commandIndex != null) 'commandIndex': commandIndex,
        'code': code,
        'path': path,
        'message': message,
        'severity': severity.wireName,
      };
}

/// A model-commands-v1 command envelope (§2.1).
class ModelCommand {
  final String type;
  final String commandId;
  final String modelId;
  final String modelVersion;
  final Map<String, dynamic> payload;

  const ModelCommand({
    required this.type,
    required this.commandId,
    required this.modelId,
    required this.modelVersion,
    required this.payload,
  });

  factory ModelCommand.fromJson(Map<String, dynamic> json) {
    return ModelCommand(
      type: json['type'] as String,
      commandId: json['commandId'] as String,
      modelId: json['modelId'] as String,
      modelVersion: json['modelVersion'] as String,
      payload: Map<String, dynamic>.from(json['payload'] as Map),
    );
  }

  Map<String, dynamic> toJson() => {
        'type': type,
        'commandId': commandId,
        'modelId': modelId,
        'modelVersion': modelVersion,
        'payload': payload,
      };
}

/// Result status of a command execution (model-commands-v1 §2.2).
enum CommandResultStatus {
  accepted('accepted'),
  rejected('rejected'),
  noop('noop');

  const CommandResultStatus(this.wireName);
  final String wireName;
}

/// Processor response for a single command (model-commands-v1 §8).
class CommandResult {
  final String commandId;
  final CommandResultStatus result;
  final String modelVersion;
  final List<CommandDiagnostic> errors;
  final List<CommandDiagnostic> warnings;

  const CommandResult({
    required this.commandId,
    required this.result,
    required this.modelVersion,
    this.errors = const [],
    this.warnings = const [],
  });
}
