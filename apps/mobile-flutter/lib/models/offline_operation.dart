/// Types of offline operations supported by mobile-offline-v1 §3.2.
enum OperationType {
  create,
  update,
  delete,
}

/// Lifecycle status of an enqueued offline operation according to mobile-offline-v1 §3.3.
enum OperationStatus {
  pending,
  inFlight,
  confirmed,
  failedRetryable,
  failedPermanent,
  cancelled,
}

/// Representation of an offline operation in the offline queue (mobile-offline-v1 §3.2).
class OfflineOperation {
  final String operationId; // UUID v4 immutable
  final OperationType operationType;
  final String entityClassId;
  final String localId; // UUID v4 immutable
  final String? remoteId;
  final Map<String, dynamic> payload; // Immutable
  final DateTime enqueuedAt;
  final int attemptCount;
  final DateTime? lastAttemptAt;
  final OperationStatus status;

  const OfflineOperation({
    required this.operationId,
    required this.operationType,
    required this.entityClassId,
    required this.localId,
    this.remoteId,
    required this.payload,
    required this.enqueuedAt,
    this.attemptCount = 0,
    this.lastAttemptAt,
    this.status = OperationStatus.pending,
  });

  OfflineOperation copyWith({
    String? remoteId,
    Map<String, dynamic>? payload,
    int? attemptCount,
    DateTime? lastAttemptAt,
    OperationStatus? status,
    DateTime? enqueuedAt,
  }) {
    return OfflineOperation(
      operationId: operationId,
      operationType: operationType,
      entityClassId: entityClassId,
      localId: localId,
      remoteId: remoteId ?? this.remoteId,
      payload: payload ?? this.payload,
      enqueuedAt: enqueuedAt ?? this.enqueuedAt,
      attemptCount: attemptCount ?? this.attemptCount,
      lastAttemptAt: lastAttemptAt ?? this.lastAttemptAt,
      status: status ?? this.status,
    );
  }

  Map<String, dynamic> toJson() => {
        'operationId': operationId,
        'operationType': operationType.name,
        'entityClassId': entityClassId,
        'localId': localId,
        'remoteId': remoteId,
        'payload': payload,
        'enqueuedAt': enqueuedAt.toIso8601String(),
        'attemptCount': attemptCount,
        'lastAttemptAt': lastAttemptAt?.toIso8601String(),
        'status': status.name,
      };

  factory OfflineOperation.fromJson(Map<String, dynamic> json) {
    return OfflineOperation(
      operationId: json['operationId'] as String,
      operationType: OperationType.values.byName(json['operationType'] as String),
      entityClassId: json['entityClassId'] as String,
      localId: json['localId'] as String,
      remoteId: json['remoteId'] as String?,
      payload: Map<String, dynamic>.from(json['payload'] as Map),
      enqueuedAt: DateTime.parse(json['enqueuedAt'] as String),
      attemptCount: json['attemptCount'] as int? ?? 0,
      lastAttemptAt: json['lastAttemptAt'] != null
          ? DateTime.parse(json['lastAttemptAt'] as String)
          : null,
      status: OperationStatus.values.byName(json['status'] as String),
    );
  }
}

/// Confirmation entry stored in the durable confirmation log (mobile-offline-v1 §2.1 & §6.3).
class ConfirmationEntry {
  final String operationId;
  final DateTime confirmedAt;
  final String? remoteId;
  final Map<String, dynamic>? responsePayload;

  const ConfirmationEntry({
    required this.operationId,
    required this.confirmedAt,
    this.remoteId,
    this.responsePayload,
  });

  Map<String, dynamic> toJson() => {
        'operationId': operationId,
        'confirmedAt': confirmedAt.toIso8601String(),
        'remoteId': remoteId,
        'responsePayload': responsePayload,
      };

  factory ConfirmationEntry.fromJson(Map<String, dynamic> json) {
    return ConfirmationEntry(
      operationId: json['operationId'] as String,
      confirmedAt: DateTime.parse(json['confirmedAt'] as String),
      remoteId: json['remoteId'] as String?,
      responsePayload: json['responsePayload'] != null
          ? Map<String, dynamic>.from(json['responsePayload'] as Map)
          : null,
    );
  }
}

/// Snapshot entry stored in the durable descriptor snapshot (mobile-offline-v1 §2.1 & §2.2).
class DescriptorSnapshotEntry {
  final String sourceModelSha256;
  final String descriptorContractVersion;
  final String descriptorJson;
  final DateTime savedAt;

  const DescriptorSnapshotEntry({
    required this.sourceModelSha256,
    required this.descriptorContractVersion,
    required this.descriptorJson,
    required this.savedAt,
  });

  Map<String, dynamic> toJson() => {
        'sourceModelSha256': sourceModelSha256,
        'descriptorContractVersion': descriptorContractVersion,
        'descriptorJson': descriptorJson,
        'savedAt': savedAt.toIso8601String(),
      };

  factory DescriptorSnapshotEntry.fromJson(Map<String, dynamic> json) {
    return DescriptorSnapshotEntry(
      sourceModelSha256: json['sourceModelSha256'] as String,
      descriptorContractVersion: json['descriptorContractVersion'] as String,
      descriptorJson: json['descriptorJson'] as String,
      savedAt: DateTime.parse(json['savedAt'] as String),
    );
  }
}
