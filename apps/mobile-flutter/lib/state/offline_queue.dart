import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';
import '../models/offline_operation.dart';
import '../storage/offline_storage.dart';

/// Result from the server transport during queue processing.
sealed class SyncResult {
  const SyncResult();

  factory SyncResult.success({String? remoteId, Map<String, dynamic>? data}) =
      _SyncSuccess;
  factory SyncResult.retryable(String message) = _SyncRetryable;
  factory SyncResult.permanent(String message) = _SyncPermanent;
}

class _SyncSuccess extends SyncResult {
  final String? remoteId;
  final Map<String, dynamic>? data;

  const _SyncSuccess({this.remoteId, this.data});
}

class _SyncRetryable extends SyncResult {
  final String message;

  const _SyncRetryable(this.message);
}

class _SyncPermanent extends SyncResult {
  final String message;

  const _SyncPermanent(this.message);
}

/// State of the offline queue managed by Riverpod.
class OfflineQueueState {
  final List<OfflineOperation> operations;
  final List<ConfirmationEntry> confirmations;
  final bool isProcessing;
  final String? lastError;

  const OfflineQueueState({
    this.operations = const [],
    this.confirmations = const [],
    this.isProcessing = false,
    this.lastError,
  });

  int get pendingCount => operations
      .where((op) =>
          op.status == OperationStatus.pending ||
          op.status == OperationStatus.failedRetryable)
      .length;

  int get confirmedCount =>
      operations.where((op) => op.status == OperationStatus.confirmed).length;

  OfflineQueueState copyWith({
    List<OfflineOperation>? operations,
    List<ConfirmationEntry>? confirmations,
    bool? isProcessing,
    String? lastError,
  }) {
    return OfflineQueueState(
      operations: operations ?? this.operations,
      confirmations: confirmations ?? this.confirmations,
      isProcessing: isProcessing ?? this.isProcessing,
      lastError: lastError,
    );
  }
}

/// Global provider for offline storage instance (can be overridden in tests).
final offlineStorageProvider = Provider<OfflineStorage>((ref) {
  return InMemoryOfflineStorage();
});

/// Riverpod notifier managing offline queue operations and idempotency.
class OfflineQueueNotifier extends Notifier<OfflineQueueState> {
  static const int maxRetries = 10;
  static const _uuid = Uuid();

  late OfflineStorage _storage;

  @override
  OfflineQueueState build() {
    _storage = ref.watch(offlineStorageProvider);
    return const OfflineQueueState();
  }

  /// Initializes the queue by reading durable storage.
  Future<void> initializeFromStorage() async {
    final ops = await _storage.loadOperations();
    final confs = await _storage.loadConfirmations();
    state = state.copyWith(operations: ops, confirmations: confs);
  }

  /// Enqueues a new operation following mobile-offline-v1 §4 & §6.1.
  Future<OfflineOperation> enqueue({
    required OperationType type,
    required String entityClassId,
    required Map<String, dynamic> payload,
    String? localId,
  }) async {
    final assignedLocalId = localId ?? _uuid.v4();

    // Idempotency §6.1: Update coalescence
    if (type == OperationType.update) {
      final existingIndex = state.operations.indexWhere((op) =>
          op.localId == assignedLocalId &&
          op.status == OperationStatus.pending);

      if (existingIndex >= 0) {
        final existingOp = state.operations[existingIndex];
        final coalescedOp = existingOp.copyWith(
          payload: payload,
          enqueuedAt: DateTime.now(),
        );

        final updatedList = List<OfflineOperation>.from(state.operations);
        updatedList[existingIndex] = coalescedOp;

        state = state.copyWith(operations: updatedList);
        await _storage.saveOperations(updatedList);
        return coalescedOp;
      }
    }

    final newOp = OfflineOperation(
      operationId: _uuid.v4(),
      operationType: type,
      entityClassId: entityClassId,
      localId: assignedLocalId,
      payload: Map.unmodifiable(payload),
      enqueuedAt: DateTime.now(),
      status: OperationStatus.pending,
    );

    final updatedList = [...state.operations, newOp];
    state = state.copyWith(operations: updatedList);
    await _storage.saveOperations(updatedList);
    return newOp;
  }

  /// Processes queued operations FIFO per entity, guaranteeing idempotency (§6).
  Future<void> processQueue({
    required Future<SyncResult> Function(OfflineOperation operation)
        transport,
  }) async {
    if (state.isProcessing) return;
    state = state.copyWith(isProcessing: true, lastError: null);

    try {
      final currentOps = List<OfflineOperation>.from(state.operations);
      final currentConfirmations =
          List<ConfirmationEntry>.from(state.confirmations);

      // FIFO order by enqueuedAt (§4.1)
      final pendingIndices = <int>[];
      for (var i = 0; i < currentOps.length; i++) {
        final op = currentOps[i];
        if (op.status == OperationStatus.pending ||
            op.status == OperationStatus.failedRetryable) {
          pendingIndices.add(i);
        }
      }
      pendingIndices.sort((a, b) =>
          currentOps[a].enqueuedAt.compareTo(currentOps[b].enqueuedAt));

      for (final index in pendingIndices) {
        final op = currentOps[index];

        // Idempotency check (§6.3, IDEMPOTENCY_DUPLICATE):
        // If already confirmed in the confirmation log, mark confirmed without resending.
        final alreadyConfirmed = currentConfirmations
            .any((c) => c.operationId == op.operationId);
        if (alreadyConfirmed) {
          currentOps[index] =
              op.copyWith(status: OperationStatus.confirmed);
          await _storage.saveOperations(currentOps);
          continue;
        }

        // Mark in-flight
        currentOps[index] = op.copyWith(status: OperationStatus.inFlight);
        state = state.copyWith(operations: currentOps);

        final result = await transport(op);

        switch (result) {
          case _SyncSuccess(:final remoteId, :final data):
            currentOps[index] = currentOps[index].copyWith(
              status: OperationStatus.confirmed,
              remoteId: remoteId,
            );
            final confEntry = ConfirmationEntry(
              operationId: op.operationId,
              confirmedAt: DateTime.now(),
              remoteId: remoteId,
              responsePayload: data,
            );
            currentConfirmations.add(confEntry);
            await _storage.saveConfirmations(currentConfirmations);

          case _SyncRetryable(:final message):
            final newAttempts = op.attemptCount + 1;
            final isExhausted = newAttempts >= maxRetries;
            currentOps[index] = currentOps[index].copyWith(
              attemptCount: newAttempts,
              lastAttemptAt: DateTime.now(),
              status: isExhausted
                  ? OperationStatus.failedPermanent
                  : OperationStatus.failedRetryable,
            );
            state = state.copyWith(lastError: message);

          case _SyncPermanent(:final message):
            currentOps[index] = currentOps[index].copyWith(
              status: OperationStatus.failedPermanent,
              lastAttemptAt: DateTime.now(),
            );
            state = state.copyWith(lastError: message);
        }

        await _storage.saveOperations(currentOps);
        state = state.copyWith(
          operations: currentOps,
          confirmations: currentConfirmations,
        );
      }
    } finally {
      state = state.copyWith(isProcessing: false);
    }
  }

  /// Cancels an operation (§3.3).
  Future<void> cancelOperation(String operationId) async {
    final updated = state.operations.map((op) {
      if (op.operationId == operationId &&
          op.status != OperationStatus.confirmed) {
        return op.copyWith(status: OperationStatus.cancelled);
      }
      return op;
    }).toList();

    state = state.copyWith(operations: updated);
    await _storage.saveOperations(updated);
  }
}

/// Global provider for the offline queue.
final offlineQueueProvider =
    NotifierProvider<OfflineQueueNotifier, OfflineQueueState>(
  OfflineQueueNotifier.new,
);
