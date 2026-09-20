import 'dart:convert';
import 'dart:io';
import '../models/offline_operation.dart';

/// Contract for durable local offline persistence (mobile-offline-v1 §2).
abstract class OfflineStorage {
  Future<void> saveOperations(List<OfflineOperation> operations);
  Future<List<OfflineOperation>> loadOperations();

  Future<void> saveConfirmations(List<ConfirmationEntry> confirmations);
  Future<List<ConfirmationEntry>> loadConfirmations();

  Future<void> saveDescriptorSnapshot(DescriptorSnapshotEntry snapshot);
  Future<DescriptorSnapshotEntry?> loadDescriptorSnapshot();

  Future<void> clear();
}

/// Durable file-based storage ensuring data survives process and app restarts
/// (mobile-offline-v1 §2.1, invariante I4, supuesto S2).
class FileOfflineStorage implements OfflineStorage {
  final Directory directory;

  FileOfflineStorage(this.directory) {
    if (!directory.existsSync()) {
      directory.createSync(recursive: true);
    }
  }

  File get _operationsFile => File('${directory.path}/offline_queue.json');
  File get _confirmationsFile => File('${directory.path}/confirmation_log.json');
  File get _snapshotFile => File('${directory.path}/descriptor_snapshot.json');

  Future<void> _writeAtomic(File file, String content) async {
    final tempFile = File('${file.path}.tmp');
    await tempFile.writeAsString(content, flush: true);
    if (file.existsSync()) {
      await file.delete();
    }
    await tempFile.rename(file.path);
  }

  @override
  Future<void> saveOperations(List<OfflineOperation> operations) async {
    final list = operations.map((op) => op.toJson()).toList();
    final jsonStr = jsonEncode(list);
    await _writeAtomic(_operationsFile, jsonStr);
  }

  @override
  Future<List<OfflineOperation>> loadOperations() async {
    if (!_operationsFile.existsSync()) return [];
    try {
      final jsonStr = await _operationsFile.readAsString();
      final list = jsonDecode(jsonStr) as List<dynamic>;
      return list
          .map((item) => OfflineOperation.fromJson(item as Map<String, dynamic>))
          .toList();
    } catch (_) {
      return [];
    }
  }

  @override
  Future<void> saveConfirmations(List<ConfirmationEntry> confirmations) async {
    final list = confirmations.map((c) => c.toJson()).toList();
    final jsonStr = jsonEncode(list);
    await _writeAtomic(_confirmationsFile, jsonStr);
  }

  @override
  Future<List<ConfirmationEntry>> loadConfirmations() async {
    if (!_confirmationsFile.existsSync()) return [];
    try {
      final jsonStr = await _confirmationsFile.readAsString();
      final list = jsonDecode(jsonStr) as List<dynamic>;
      return list
          .map((item) => ConfirmationEntry.fromJson(item as Map<String, dynamic>))
          .toList();
    } catch (_) {
      return [];
    }
  }

  @override
  Future<void> saveDescriptorSnapshot(DescriptorSnapshotEntry snapshot) async {
    final jsonStr = jsonEncode(snapshot.toJson());
    await _writeAtomic(_snapshotFile, jsonStr);
  }

  @override
  Future<DescriptorSnapshotEntry?> loadDescriptorSnapshot() async {
    if (!_snapshotFile.existsSync()) return null;
    try {
      final jsonStr = await _snapshotFile.readAsString();
      return DescriptorSnapshotEntry.fromJson(
        jsonDecode(jsonStr) as Map<String, dynamic>,
      );
    } catch (_) {
      return null;
    }
  }

  @override
  Future<void> clear() async {
    if (_operationsFile.existsSync()) await _operationsFile.delete();
    if (_confirmationsFile.existsSync()) await _confirmationsFile.delete();
    if (_snapshotFile.existsSync()) await _snapshotFile.delete();
  }
}

/// In-memory storage implementation for isolated fast unit tests.
class InMemoryOfflineStorage implements OfflineStorage {
  final List<OfflineOperation> _operations = [];
  final List<ConfirmationEntry> _confirmations = [];
  DescriptorSnapshotEntry? _snapshot;

  @override
  Future<void> saveOperations(List<OfflineOperation> operations) async {
    _operations.clear();
    _operations.addAll(operations);
  }

  @override
  Future<List<OfflineOperation>> loadOperations() async {
    return List.unmodifiable(_operations);
  }

  @override
  Future<void> saveConfirmations(List<ConfirmationEntry> confirmations) async {
    _confirmations.clear();
    _confirmations.addAll(confirmations);
  }

  @override
  Future<List<ConfirmationEntry>> loadConfirmations() async {
    return List.unmodifiable(_confirmations);
  }

  @override
  Future<void> saveDescriptorSnapshot(DescriptorSnapshotEntry snapshot) async {
    _snapshot = snapshot;
  }

  @override
  Future<DescriptorSnapshotEntry?> loadDescriptorSnapshot() async {
    return _snapshot;
  }

  @override
  Future<void> clear() async {
    _operations.clear();
    _confirmations.clear();
    _snapshot = null;
  }
}
