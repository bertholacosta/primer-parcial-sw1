import 'dart:io';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_flutter/models/offline_operation.dart';
import 'package:mobile_flutter/state/offline_queue.dart';
import 'package:mobile_flutter/storage/offline_storage.dart';

void main() {
  group('P3-004 Acceptance Criterion 1: Persistence and Restart Without Network', () {
    late Directory tempDir;

    setUp(() {
      tempDir = Directory.systemTemp.createTempSync('offline_persistence_test_');
    });

    tearDown(() {
      if (tempDir.existsSync()) {
        tempDir.deleteSync(recursive: true);
      }
    });

    test('operation survives process restart without network and is preserved until confirmation',
        () async {
      // 1. Arrange: Session 1 (before restart)
      final storageSession1 = FileOfflineStorage(tempDir);
      final containerSession1 = ProviderContainer(
        overrides: [
          offlineStorageProvider.overrideWithValue(storageSession1),
        ],
      );
      addTearDown(containerSession1.dispose);

      final notifier1 = containerSession1.read(offlineQueueProvider.notifier);
      await notifier1.initializeFromStorage();

      // Enqueue an operation offline without network
      const payload = {
        'titulo': 'El Aleph',
        'isbn': '978-8420633114',
        'fechaPublicacion': '1949-06-01',
      };
      final enqueuedOp = await notifier1.enqueue(
        type: OperationType.create,
        entityClassId: 'cls-01',
        payload: payload,
      );

      expect(enqueuedOp.status, equals(OperationStatus.pending));
      expect(enqueuedOp.operationId, isNotEmpty);
      expect(enqueuedOp.localId, isNotEmpty);
      expect(enqueuedOp.attemptCount, equals(0));

      final state1 = containerSession1.read(offlineQueueProvider);
      expect(state1.pendingCount, equals(1));
      expect(state1.confirmedCount, equals(0));

      // 2. Act: Simulate App / Process Restart without network
      // Session 1 is disposed/closed. We create a completely fresh Session 2
      // reading strictly from the durable files on disk.
      final storageSession2 = FileOfflineStorage(tempDir);
      final containerSession2 = ProviderContainer(
        overrides: [
          offlineStorageProvider.overrideWithValue(storageSession2),
        ],
      );
      addTearDown(containerSession2.dispose);

      final notifier2 = containerSession2.read(offlineQueueProvider.notifier);
      await notifier2.initializeFromStorage();

      final state2 = containerSession2.read(offlineQueueProvider);

      // Assert restart durability: The pending operation survived restart exactly as enqueued
      expect(state2.pendingCount, equals(1));
      expect(state2.operations.length, equals(1));

      final restoredOp = state2.operations.first;
      expect(restoredOp.operationId, equals(enqueuedOp.operationId));
      expect(restoredOp.localId, equals(enqueuedOp.localId));
      expect(restoredOp.entityClassId, equals('cls-01'));
      expect(restoredOp.operationType, equals(OperationType.create));
      expect(restoredOp.payload, equals(payload));
      expect(restoredOp.status, equals(OperationStatus.pending));
      expect(restoredOp.attemptCount, equals(0));

      // 3. Act: Network restored; sync and confirm operation
      var transportCalled = false;
      await notifier2.processQueue(
        transport: (op) async {
          transportCalled = true;
          expect(op.operationId, equals(enqueuedOp.operationId));
          expect(op.localId, equals(enqueuedOp.localId));
          return SyncResult.success(remoteId: 'remote-srv-001');
        },
      );

      expect(transportCalled, isTrue);

      final stateAfterSync = containerSession2.read(offlineQueueProvider);
      expect(stateAfterSync.pendingCount, equals(0));
      expect(stateAfterSync.confirmedCount, equals(1));
      final confirmedOp = stateAfterSync.operations.first;
      expect(confirmedOp.status, equals(OperationStatus.confirmed));
      expect(confirmedOp.remoteId, equals('remote-srv-001'));

      // 4. Act: Simulate a second restart to ensure confirmed state is also durable
      final storageSession3 = FileOfflineStorage(tempDir);
      final containerSession3 = ProviderContainer(
        overrides: [
          offlineStorageProvider.overrideWithValue(storageSession3),
        ],
      );
      addTearDown(containerSession3.dispose);

      final notifier3 = containerSession3.read(offlineQueueProvider.notifier);
      await notifier3.initializeFromStorage();

      final state3 = containerSession3.read(offlineQueueProvider);
      expect(state3.pendingCount, equals(0));
      expect(state3.confirmedCount, equals(1));
      expect(state3.confirmations.length, equals(1));
      expect(state3.confirmations.first.operationId, equals(enqueuedOp.operationId));
      expect(state3.confirmations.first.remoteId, equals('remote-srv-001'));
    });

    test('descriptor snapshot survives restart and preserves sha256', () async {
      final storage1 = FileOfflineStorage(tempDir);
      final snapshot = DescriptorSnapshotEntry(
        sourceModelSha256: 'd73089914b328bda5253583484fd66066123d769b6f40982a272c65902baf483',
        descriptorContractVersion: '1',
        descriptorJson: '{"descriptorContractVersion":"1"}',
        savedAt: DateTime.now(),
      );

      await storage1.saveDescriptorSnapshot(snapshot);

      // Reopen storage from same directory
      final storage2 = FileOfflineStorage(tempDir);
      final loaded = await storage2.loadDescriptorSnapshot();

      expect(loaded, isNotNull);
      expect(loaded!.sourceModelSha256, equals(snapshot.sourceModelSha256));
      expect(loaded.descriptorContractVersion, equals('1'));
      expect(loaded.descriptorJson, equals(snapshot.descriptorJson));
    });
  });
}
