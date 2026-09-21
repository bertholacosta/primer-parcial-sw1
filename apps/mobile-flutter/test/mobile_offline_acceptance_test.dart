import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_flutter/main.dart';
import 'package:mobile_flutter/models/descriptor.dart';
import 'package:mobile_flutter/models/offline_operation.dart';
import 'package:mobile_flutter/state/descriptor_state.dart';
import 'package:mobile_flutter/state/offline_queue.dart';
import 'package:mobile_flutter/storage/offline_storage.dart';

/// P9-002 — Automated mobile & offline acceptance (mobile-offline-v1).
///
/// Reproduces, without manual intervention, the agreed scenario:
/// dynamic descriptor load → offline editing → process restart without
/// network → idempotent retry → no duplicates. The test writes
/// machine-readable evidence to `build/mobile-offline-acceptance/evidence.json`
/// (gitignored), which `scripts/validate-mobile-offline.ps1` validates.
///
/// Real file IO (FileOfflineStorage) must run inside `tester.runAsync`:
/// `testWidgets` executes in a fake-async zone where real IO futures would
/// never resume.
void main() {
  testWidgets(
    'dynamic load, offline edit, restart without network and idempotent retry',
    (tester) async {
      const descriptorAssetPath = 'assets/flutter-descriptor.json';
      const evidencePath = 'build/mobile-offline-acceptance/evidence.json';

      final connectivityTimeline = <String>[];
      final transportDeliveries = <Map<String, dynamic>>[];
      var deliveriesAfterConfirmation = 0;

      // --- Step 1: dynamic load of the versioned descriptor -------------------
      final descriptorFile = File(descriptorAssetPath);
      expect(
        descriptorFile.existsSync(),
        isTrue,
        reason: 'the versioned descriptor asset must exist',
      );
      final descriptorJson = descriptorFile.readAsStringSync();
      final descriptor = DescriptorRoot.fromString(descriptorJson);
      connectivityTimeline.add('session1:online');

      final workDir = Directory.systemTemp.createTempSync('p9_002_acceptance_');
      addTearDown(() {
        try {
          if (workDir.existsSync()) workDir.deleteSync(recursive: true);
        } on FileSystemException {
          // Best-effort cleanup: a late flush may briefly hold a handle.
        }
      });

      // Drains the write→delete→rename chain of FileOfflineStorage: each real
      // IO needs the real event loop (runAsync) and each continuation needs a
      // fake-zone flush (pump).
      Future<List<OfflineOperation>> loadPersistedOperations() async {
        List<OfflineOperation>? ops;
        for (var i = 0; i < 40; i++) {
          await tester.runAsync(
            () => Future<void>.delayed(const Duration(milliseconds: 25)),
          );
          await tester.pump();
          ops = await tester.runAsync(
            () => FileOfflineStorage(workDir).loadOperations(),
          );
          if (ops != null && ops.isNotEmpty) break;
        }
        return ops ?? const [];
      }

      // --- Step 2: session 1 — render dynamic UI and edit while offline -------
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            offlineStorageProvider
                .overrideWithValue(FileOfflineStorage(workDir)),
          ],
          child: const MaterialApp(home: DynamicDescriptorHomeScreen()),
        ),
      );
      await tester.pumpAndSettle(
        const Duration(milliseconds: 100),
        EnginePhase.sendSemanticsUpdate,
        const Duration(seconds: 30),
      );

      final container1 = ProviderScope.containerOf(
        tester.element(find.byType(DynamicDescriptorHomeScreen)),
      );

      // autoLoad → loadFromAsset must reach the ready state (§14.1).
      final descriptorState1 = container1.read(descriptorProvider);
      expect(
        descriptorState1,
        isA<DescriptorReady>(),
        reason: 'dynamic load must reach the ready state',
      );
      final ready1 = descriptorState1 as DescriptorReady;
      expect(ready1.isStale, isFalse);
      expect(
        ready1.descriptor.sourceModelSha256,
        equals(descriptor.sourceModelSha256),
      );

      // Persist the verified descriptor snapshot (mobile-offline-v1 §2.2).
      final storage1 = container1.read(offlineStorageProvider);
      await tester.runAsync(
        () => storage1.saveDescriptorSnapshot(
          DescriptorSnapshotEntry(
            sourceModelSha256: ready1.descriptor.sourceModelSha256,
            descriptorContractVersion:
                ready1.descriptor.descriptorContractVersion,
            descriptorJson: descriptorJson,
            savedAt: DateTime.now(),
          ),
        ),
      );

      // The dynamic UI must render the fields declared by the descriptor.
      expect(find.byKey(const Key('field_titulo')), findsOneWidget);
      expect(find.byKey(const Key('field_isbn')), findsOneWidget);
      expect(find.byKey(const Key('field_fechaPublicacion')), findsOneWidget);

      // Edit + save → exactly one operation is enqueued durably.
      await tester.enterText(
          find.byKey(const Key('field_titulo')), 'El Aleph');
      await tester.enterText(
          find.byKey(const Key('field_isbn')), '978-8420633114');
      await tester.enterText(find.byKey(const Key('field_fechaPublicacion')),
          '1949-06-01');
      await tester.tap(find.byKey(const Key('btn_save_libro')));
      await tester.pumpAndSettle(
        const Duration(milliseconds: 100),
        EnginePhase.sendSemanticsUpdate,
        const Duration(seconds: 30),
      );

      final queue1 = container1.read(offlineQueueProvider);
      expect(
        queue1.operations.length,
        equals(1),
        reason: 'a single edit must enqueue a single operation',
      );
      final operation = queue1.operations.first;
      expect(operation.status, equals(OperationStatus.pending));
      expect(operation.entityClassId, equals('cls-01'));
      expect(operation.payload['titulo'], equals('El Aleph'));
      expect(operation.attemptCount, equals(0));

      // The enqueue must already be durable on disk (§4.1, synchronous
      // enqueue guarantee) before any restart.
      final persistedOps = await loadPersistedOperations();
      expect(persistedOps.length, equals(1));
      expect(persistedOps.first.operationId, equals(operation.operationId));

      // --- Step 3: restart without network ------------------------------------
      connectivityTimeline.add('restart:offline');
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            offlineStorageProvider
                .overrideWithValue(FileOfflineStorage(workDir)),
          ],
          child: const MaterialApp(
            home: DynamicDescriptorHomeScreen(autoLoad: false),
          ),
        ),
      );
      await tester.pumpAndSettle(
        const Duration(milliseconds: 100),
        EnginePhase.sendSemanticsUpdate,
        const Duration(seconds: 30),
      );

      final container2 = ProviderScope.containerOf(
        tester.element(find.byType(DynamicDescriptorHomeScreen)),
      );
      final notifier2 = container2.read(offlineQueueProvider.notifier);
      await tester.runAsync(() => notifier2.initializeFromStorage());
      await tester.pump();

      // Dynamic load after restart resolves from the durable snapshot — no
      // network is involved (mobile-offline-v1 §2.2, supuesto S2).
      final snapshot = await tester.runAsync(
        () => container2.read(offlineStorageProvider).loadDescriptorSnapshot(),
      );
      expect(
        snapshot,
        isNotNull,
        reason: 'the descriptor snapshot must survive the restart',
      );
      expect(snapshot!.descriptorContractVersion, equals('1'));
      expect(snapshot.sourceModelSha256, equals(descriptor.sourceModelSha256));
      container2
          .read(descriptorProvider.notifier)
          .loadFromJsonString(snapshot.descriptorJson);
      await tester.pumpAndSettle(
        const Duration(milliseconds: 100),
        EnginePhase.sendSemanticsUpdate,
        const Duration(seconds: 30),
      );

      final descriptorState2 = container2.read(descriptorProvider);
      expect(
        descriptorState2,
        isA<DescriptorReady>(),
        reason: 'the dynamic UI must be restored from the snapshot offline',
      );
      expect(find.byKey(const Key('field_titulo')), findsOneWidget);

      // The pending operation survived the restart untouched (§4.1).
      final queue2 = container2.read(offlineQueueProvider);
      expect(queue2.operations.length, equals(1));
      final restored = queue2.operations.first;
      expect(restored.operationId, equals(operation.operationId));
      expect(restored.localId, equals(operation.localId));
      expect(restored.status, equals(OperationStatus.pending));
      expect(restored.payload, equals(operation.payload));

      // --- Step 4: idempotent retry -------------------------------------------
      // First attempt: still offline → retryable failure (§5.2).
      connectivityTimeline.add('retry1:offline');
      await tester.runAsync(
        () => notifier2.processQueue(
          transport: (op) async {
            transportDeliveries.add({
              'operationId': op.operationId,
              'localId': op.localId,
              'result': 'retryable',
              'detail': 'network unreachable (offline)',
            });
            return SyncResult.retryable('network unreachable (offline)');
          },
        ),
      );

      var current = container2.read(offlineQueueProvider).operations.first;
      expect(current.status, equals(OperationStatus.failedRetryable));
      expect(current.attemptCount, equals(1));
      expect(
        current.operationId,
        equals(operation.operationId),
        reason: 'operationId is immutable across retries (invariant I1)',
      );

      // Second attempt: connectivity restored → confirmed.
      connectivityTimeline.add('retry2:online');
      await tester.runAsync(
        () => notifier2.processQueue(
          transport: (op) async {
            transportDeliveries.add({
              'operationId': op.operationId,
              'localId': op.localId,
              'result': 'confirmed',
              'remoteId': 'srv-libro-0001',
            });
            return SyncResult.success(remoteId: 'srv-libro-0001');
          },
        ),
      );

      final queue3 = container2.read(offlineQueueProvider);
      current = queue3.operations.first;
      expect(current.status, equals(OperationStatus.confirmed));
      expect(current.remoteId, equals('srv-libro-0001'));
      expect(
        current.localId,
        equals(operation.localId),
        reason: 'localId is stable after confirmation (invariant I2)',
      );
      expect(queue3.confirmations.length, equals(1));
      expect(
        queue3.confirmations.first.operationId,
        equals(operation.operationId),
      );

      // Reprocessing must not deliver the confirmed operation again (§6.3,
      // IDEMPOTENCY_DUPLICATE).
      await tester.runAsync(
        () => notifier2.processQueue(
          transport: (_) async {
            deliveriesAfterConfirmation++;
            return SyncResult.success();
          },
        ),
      );
      expect(
        deliveriesAfterConfirmation,
        equals(0),
        reason: 'a confirmed operation must never be resent',
      );

      // --- Step 5: evidence ----------------------------------------------------
      final distinctOperationIds =
          transportDeliveries.map((d) => d['operationId']).toSet();
      final duplicatesDetected = queue3.operations.length != 1 ||
          queue3.confirmations.length != 1 ||
          deliveriesAfterConfirmation != 0;
      expect(duplicatesDetected, isFalse);

      final evidence = <String, dynamic>{
        'task': 'P9-002',
        'generatedAt': DateTime.now().toIso8601String(),
        'contracts': {
          'mobileOffline': 'mobile-offline-v1',
          'flutterDescriptor': 'flutter-descriptor-v1',
        },
        'descriptor': {
          'assetPath': descriptorAssetPath,
          'descriptorContractVersion': descriptor.descriptorContractVersion,
          'descriptorVersion': descriptor.descriptorVersion,
          'sourceModelId': descriptor.sourceModelId,
          'sourceModelVersion': descriptor.sourceModelVersion,
          'sourceModelSha256': descriptor.sourceModelSha256,
          'generatorVersion': descriptor.generatorVersion,
          'classCount': descriptor.classes.length,
          'associationCount': descriptor.associations.length,
          'reloadedFromSnapshotOffline': true,
        },
        'scenario': {
          'connectivityTimeline': connectivityTimeline,
          'dynamicLoadState': 'ready',
          'editedEntityClassId': 'cls-01',
          'operation': {
            'operationId': operation.operationId,
            'localId': operation.localId,
            'operationType': operation.operationType.name,
            'status': current.status.name,
            'attemptCount': current.attemptCount,
            'remoteId': current.remoteId,
          },
          'restartWithoutNetwork': {
            'operationPreserved': true,
            'descriptorSnapshotLoaded': true,
            'networkUsed': false,
          },
          'transportDeliveries': transportDeliveries,
        },
        'duplicates': {
          'operationsEnqueued': queue3.operations.length,
          'confirmationEntries': queue3.confirmations.length,
          'distinctOperationIdsDelivered': distinctOperationIds.length,
          'deliveriesAfterConfirmation': deliveriesAfterConfirmation,
          'duplicatesDetected': duplicatesDetected,
        },
        'verdict': 'pass',
      };

      final evidenceFile = File(evidencePath);
      evidenceFile.parent.createSync(recursive: true);
      evidenceFile.writeAsStringSync(
        const JsonEncoder.withIndent('  ').convert(evidence),
      );
    },
  );
}
