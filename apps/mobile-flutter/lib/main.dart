import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'models/descriptor.dart';
import 'models/offline_operation.dart';
import 'state/descriptor_state.dart';
import 'state/offline_queue.dart';
import 'widgets/dynamic_form.dart';
import 'widgets/guided_onboarding.dart';

void main() {
  runApp(const ProviderScope(child: MobileFlutterApp()));
}

class MobileFlutterApp extends StatelessWidget {
  const MobileFlutterApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Mobile Flutter',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: Colors.indigo),
        useMaterial3: true,
      ),
      home: const DynamicDescriptorHomeScreen(),
    );
  }
}

class DynamicDescriptorHomeScreen extends ConsumerStatefulWidget {
  final String assetPath;
  final bool autoLoad;

  const DynamicDescriptorHomeScreen({
    super.key,
    this.assetPath = 'assets/flutter-descriptor.json',
    this.autoLoad = true,
  });

  @override
  ConsumerState<DynamicDescriptorHomeScreen> createState() =>
      _DynamicDescriptorHomeScreenState();
}

class _DynamicDescriptorHomeScreenState
    extends ConsumerState<DynamicDescriptorHomeScreen> {
  ClassDescriptor? _selectedClass;
  Map<String, dynamic>? _lastSavedEntity;

  @override
  void initState() {
    super.initState();
    if (widget.autoLoad) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        ref.read(descriptorProvider.notifier).loadFromAsset(widget.assetPath);
        ref.read(offlineQueueProvider.notifier).initializeFromStorage();
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(descriptorProvider);
    final queue = ref.watch(offlineQueueProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Dynamic Model Slice'),
        backgroundColor: Theme.of(context).colorScheme.inversePrimary,
        actions: [
          IconButton(
            key: const Key('open_onboarding'),
            icon: const Icon(Icons.assistant),
            tooltip: 'Onboarding guiado por propuestas',
            onPressed: () {
              Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => const GuidedOnboardingScreen(),
                ),
              );
            },
          ),
          Padding(
            padding: const EdgeInsets.only(right: 16.0),
            child: Center(
              child: Badge(
                key: const Key('badge_offline_queue'),
                label: Text('${queue.pendingCount}'),
                child: const Icon(Icons.cloud_queue),
              ),
            ),
          ),
        ],
      ),
      body: switch (state) {
        DescriptorInitial() || DescriptorLoading() => const Center(
            key: Key('descriptor_loading'),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                CircularProgressIndicator(),
                SizedBox(height: 12),
                Text('Loading model descriptor...'),
              ],
            ),
          ),
        DescriptorErrorContractMismatch(:final message) => Center(
            key: const Key('error_contract_mismatch'),
            child: Card(
              color: Colors.red.shade50,
              margin: const EdgeInsets.all(24.0),
              child: Padding(
                padding: const EdgeInsets.all(20.0),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.error_outline, size: 48, color: Colors.red),
                    const SizedBox(height: 12),
                    const Text(
                      'Descriptor Contract Incompatible',
                      style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                    ),
                    const SizedBox(height: 8),
                    Text(message, textAlign: TextAlign.center),
                    const SizedBox(height: 16),
                    const Text(
                      'Please update the application to support the active model.',
                      style: TextStyle(fontStyle: FontStyle.italic),
                    ),
                  ],
                ),
              ),
            ),
          ),
        DescriptorErrorMissingField(:final message) => Center(
            key: const Key('error_missing_field'),
            child: Card(
              color: Colors.orange.shade50,
              margin: const EdgeInsets.all(24.0),
              child: Padding(
                padding: const EdgeInsets.all(20.0),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.warning_amber, size: 48, color: Colors.orange),
                    const SizedBox(height: 12),
                    const Text(
                      'Descriptor Corrupt or Incomplete',
                      style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                    ),
                    const SizedBox(height: 8),
                    Text(message, textAlign: TextAlign.center),
                  ],
                ),
              ),
            ),
          ),
        DescriptorUnavailable(:final message) => Center(
            key: const Key('descriptor_unavailable'),
            child: Padding(
              padding: const EdgeInsets.all(24.0),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.cloud_off, size: 48, color: Colors.grey),
                  const SizedBox(height: 12),
                  const Text(
                    'Descriptor Unavailable',
                    style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(height: 8),
                  Text(message, textAlign: TextAlign.center),
                ],
              ),
            ),
          ),
        DescriptorReady(:final descriptor, :final isStale, :final staleReason) =>
          _buildReadyContent(descriptor, isStale, staleReason, queue),
      },
    );
  }

  Widget _buildReadyContent(
    DescriptorRoot descriptor,
    bool isStale,
    String? staleReason,
    OfflineQueueState queue,
  ) {
    final activeClass = _selectedClass ??
        (descriptor.classes.isNotEmpty ? descriptor.classes.first : null);

    return SingleChildScrollView(
      padding: const EdgeInsets.all(16.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (isStale)
            Container(
              key: const Key('banner_stale'),
              margin: const EdgeInsets.only(bottom: 12.0),
              padding: const EdgeInsets.all(12.0),
              decoration: BoxDecoration(
                color: Colors.amber.shade100,
                borderRadius: BorderRadius.circular(8.0),
                border: Border.all(color: Colors.amber.shade700),
              ),
              child: Row(
                children: [
                  const Icon(Icons.info, color: Colors.amber),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      staleReason ?? 'Model descriptor is stale.',
                      style: const TextStyle(fontWeight: FontWeight.w600),
                    ),
                  ),
                ],
              ),
            ),
          Text(
            'Model: ${descriptor.sourceModelId} (v${descriptor.sourceModelVersion})',
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8.0,
            children: descriptor.classes.map((cls) {
              final isSelected = activeClass?.id == cls.id;
              return ChoiceChip(
                key: Key('chip_class_${cls.name.toLowerCase()}'),
                label: Text(cls.name),
                selected: isSelected,
                onSelected: (_) {
                  setState(() {
                    _selectedClass = cls;
                    _lastSavedEntity = null;
                  });
                },
              );
            }).toList(),
          ),
          const Divider(height: 24),
          if (activeClass != null) ...[
            Text(
              'Entity: ${activeClass.name}',
              style: Theme.of(context).textTheme.titleLarge,
            ),
            if (activeClass.description != null) ...[
              const SizedBox(height: 4),
              Text(
                activeClass.description!,
                style: Theme.of(context).textTheme.bodyMedium,
              ),
            ],
            const SizedBox(height: 16),
            DynamicEntityForm(
              key: ValueKey(activeClass.id),
              classDescriptor: activeClass,
              onSave: (values) async {
                setState(() {
                  _lastSavedEntity = values;
                });
                final op = await ref.read(offlineQueueProvider.notifier).enqueue(
                      type: OperationType.create,
                      entityClassId: activeClass.id,
                      payload: values,
                    );
                if (mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                      key: const Key('snackbar_saved'),
                      content: Text(
                          '${activeClass.name} saved and enqueued offline (op: ${op.operationId.substring(0, 8)}).'),
                    ),
                  );
                }
              },
            ),
            if (_lastSavedEntity != null) ...[
              const SizedBox(height: 16),
              Card(
                key: const Key('card_saved_entity'),
                child: Padding(
                  padding: const EdgeInsets.all(12.0),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Saved ${activeClass.name} State:',
                        style: const TextStyle(fontWeight: FontWeight.bold),
                      ),
                      const SizedBox(height: 6),
                      Text(_lastSavedEntity.toString()),
                    ],
                  ),
                ),
              ),
            ],
          ],
          if (queue.operations.isNotEmpty) ...[
            const SizedBox(height: 24),
            Text(
              'Offline Queue (${queue.pendingCount} pending / ${queue.confirmedCount} confirmed):',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            ...queue.operations.map((op) => ListTile(
                  dense: true,
                  leading: Icon(
                    op.status == OperationStatus.confirmed
                        ? Icons.check_circle
                        : Icons.hourglass_top,
                    color: op.status == OperationStatus.confirmed
                        ? Colors.green
                        : Colors.orange,
                  ),
                  title: Text(
                    '${op.operationType.name.toUpperCase()} ${op.entityClassId}',
                  ),
                  subtitle: Text(
                    'Op: ${op.operationId.substring(0, 8)} | LocalId: ${op.localId.substring(0, 8)} | Status: ${op.status.name}',
                  ),
                )),
          ],
        ],
      ),
    );
  }
}
