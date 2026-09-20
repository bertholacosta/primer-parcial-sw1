import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_flutter/models/offline_operation.dart';
import 'package:mobile_flutter/state/offline_queue.dart';
import 'package:mobile_flutter/storage/offline_storage.dart';

void main() {
  group('P3-004 Acceptance Criterion 2: Idempotency and Deduplication in Retries', () {
    late InMemoryOfflineStorage storage;
    late ProviderContainer container;
    late OfflineQueueNotifier notifier;

    setUp(() async {
      storage = InMemoryOfflineStorage();
      container = ProviderContainer(
        overrides: [
          offlineStorageProvider.overrideWithValue(storage),
        ],
      );
      notifier = container.read(offlineQueueProvider.notifier);
      await notifier.initializeFromStorage();
    });

    tearDown(() {
      container.dispose();
    });

    test('retries do not duplicate the operation and preserve operationId throughout backoff', () async {
      final receivedCalls = <Map<String, dynamic>>[];

      // 1. Enqueue operation
      final op = await notifier.enqueue(
        type: OperationType.create,
        entityClassId: 'cls-01',
        payload: {'titulo': 'Ficciones', 'isbn': '978-0307474728'},
      );

      final initialOpId = op.operationId;
      final initialLocalId = op.localId;

      expect(container.read(offlineQueueProvider).operations.length, equals(1));

      // 2. Attempt 1: Transient network failure (HTTP 503)
      await notifier.processQueue(
        transport: (operation) async {
          receivedCalls.add({
            'attempt': 1,
            'opId': operation.operationId,
            'localId': operation.localId,
          });
          return SyncResult.retryable('HTTP 503 Service Unavailable');
        },
      );

      var state = container.read(offlineQueueProvider);
      expect(state.operations.length, equals(1), reason: 'Queue length must remain 1');
      var currentOp = state.operations.first;
      expect(currentOp.status, equals(OperationStatus.failedRetryable));
      expect(currentOp.attemptCount, equals(1));
      expect(currentOp.operationId, equals(initialOpId));
      expect(currentOp.localId, equals(initialLocalId));

      // 3. Attempt 2: Network timeout (retryable)
      await notifier.processQueue(
        transport: (operation) async {
          receivedCalls.add({
            'attempt': 2,
            'opId': operation.operationId,
            'localId': operation.localId,
          });
          return SyncResult.retryable('SocketException: Connection timed out');
        },
      );

      state = container.read(offlineQueueProvider);
      expect(state.operations.length, equals(1), reason: 'Queue length must remain 1');
      currentOp = state.operations.first;
      expect(currentOp.status, equals(OperationStatus.failedRetryable));
      expect(currentOp.attemptCount, equals(2));
      expect(currentOp.operationId, equals(initialOpId));

      // 4. Attempt 3: Success
      await notifier.processQueue(
        transport: (operation) async {
          receivedCalls.add({
            'attempt': 3,
            'opId': operation.operationId,
            'localId': operation.localId,
          });
          return SyncResult.success(remoteId: 'srv-uuid-999');
        },
      );

      state = container.read(offlineQueueProvider);
      expect(state.operations.length, equals(1), reason: 'Queue length must remain 1');
      currentOp = state.operations.first;
      expect(currentOp.status, equals(OperationStatus.confirmed));
      expect(currentOp.remoteId, equals('srv-uuid-999'));

      // Verify that all 3 attempts sent the EXACT same operationId and localId (idempotency)
      expect(receivedCalls.length, equals(3));
      for (final call in receivedCalls) {
        expect(call['opId'], equals(initialOpId));
        expect(call['localId'], equals(initialLocalId));
      }

      // 5. Deduplication check (§6.3, IDEMPOTENCY_DUPLICATE):
      // If processQueue is called again on the confirmed operation, transport must NOT be invoked!
      var redundantTransportInvoked = false;
      await notifier.processQueue(
        transport: (_) async {
          redundantTransportInvoked = true;
          return SyncResult.success();
        },
      );

      expect(redundantTransportInvoked, isFalse);
      expect(container.read(offlineQueueProvider).operations.length, equals(1));
    });

    test('update coalescence (§6.1) replaces payload and preserves operationId while pending',
        () async {
      const localId = 'local-entity-001';

      // First update enqueued
      final op1 = await notifier.enqueue(
        type: OperationType.update,
        entityClassId: 'cls-01',
        localId: localId,
        payload: {'titulo': 'Draft 1'},
      );

      expect(op1.payload['titulo'], equals('Draft 1'));
      expect(container.read(offlineQueueProvider).operations.length, equals(1));

      // Second update enqueued while first is still pending
      final op2 = await notifier.enqueue(
        type: OperationType.update,
        entityClassId: 'cls-01',
        localId: localId,
        payload: {'titulo': 'Draft 2 Final'},
      );

      // Coalesced in place: same operationId, updated payload, queue size still 1
      expect(op2.operationId, equals(op1.operationId));
      expect(op2.payload['titulo'], equals('Draft 2 Final'));
      final state = container.read(offlineQueueProvider);
      expect(state.operations.length, equals(1));
      expect(state.operations.first.payload['titulo'], equals('Draft 2 Final'));
    });

    test('permanent failure (HTTP 400/422) transitions directly to failedPermanent without retry',
        () async {
      await notifier.enqueue(
        type: OperationType.create,
        entityClassId: 'cls-01',
        payload: {'titulo': 'Invalid Book'},
      );

      await notifier.processQueue(
        transport: (_) async => SyncResult.permanent('HTTP 422 Unprocessable Entity'),
      );

      final state = container.read(offlineQueueProvider);
      final op = state.operations.first;
      expect(op.status, equals(OperationStatus.failedPermanent));
      expect(state.pendingCount, equals(0));
    });

    test('exceeding max retries (10 attempts) marks operation failedPermanent', () async {
      await notifier.enqueue(
        type: OperationType.create,
        entityClassId: 'cls-01',
        payload: {'titulo': 'Retry Test'},
      );

      for (var i = 0; i < 10; i++) {
        await notifier.processQueue(
          transport: (_) async => SyncResult.retryable('Temporary 500 error'),
        );
      }

      final state = container.read(offlineQueueProvider);
      final op = state.operations.first;
      expect(op.status, equals(OperationStatus.failedPermanent));
      expect(op.attemptCount, equals(10));
    });
  });
}
