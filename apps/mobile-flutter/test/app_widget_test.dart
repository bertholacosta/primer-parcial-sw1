import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_flutter/main.dart';
import 'package:mobile_flutter/models/descriptor.dart';
import 'package:mobile_flutter/state/descriptor_state.dart';

void main() {
  group('DynamicDescriptorHomeScreen & App Integration', () {
    testWidgets('renders loading state initially', (tester) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            descriptorProvider.overrideWith(() => _MockNotifier(
                  const DescriptorLoading(),
                )),
          ],
          child: const MaterialApp(
            home: DynamicDescriptorHomeScreen(autoLoad: false),
          ),
        ),
      );

      // Verify loading indicator is present
      expect(find.byKey(const Key('descriptor_loading')), findsOneWidget);
    });

    testWidgets('renders ready state with class chips and dynamic form', (tester) async {
      const sampleDescriptor = DescriptorRoot(
        descriptorContractVersion: '1',
        descriptorVersion: '1.0.0',
        sourceModelId: 'test-model-id',
        sourceModelVersion: '1.0.0',
        sourceModelContractVersion: '1',
        sourceModelSha256: 'test-sha256',
        generatorVersion: '1.0.0',
        classes: [
          ClassDescriptor(
            id: 'cls-01',
            name: 'Libro',
            attributes: [
              AttributeDescriptor(
                id: 'attr-01',
                name: 'titulo',
                type: 'String',
                nullable: false,
                multiplicity: '1',
                uiType: 'textField',
                required: true,
              ),
            ],
          ),
          ClassDescriptor(
            id: 'cls-02',
            name: 'Autor',
            attributes: [
              AttributeDescriptor(
                id: 'attr-02',
                name: 'nombre',
                type: 'String',
                nullable: false,
                multiplicity: '1',
                uiType: 'textField',
                required: true,
              ),
            ],
          ),
        ],
        associations: [],
      );

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            descriptorProvider.overrideWith(() => _MockNotifier(
                  const DescriptorReady(sampleDescriptor),
                )),
          ],
          child: const MaterialApp(
            home: DynamicDescriptorHomeScreen(autoLoad: false),
          ),
        ),
      );

      await tester.pumpAndSettle();

      // Verify classes from descriptor are displayed as chips
      expect(find.byKey(const Key('chip_class_libro')), findsOneWidget);
      expect(find.byKey(const Key('chip_class_autor')), findsOneWidget);

      // Active class Libro rendered dynamically
      expect(find.text('Entity: Libro'), findsOneWidget);
      expect(find.byKey(const Key('field_titulo')), findsOneWidget);

      // Switch to Autor chip
      await tester.tap(find.byKey(const Key('chip_class_autor')));
      await tester.pumpAndSettle();

      expect(find.text('Entity: Autor'), findsOneWidget);
      expect(find.byKey(const Key('field_nombre')), findsOneWidget);
    });

    testWidgets('renders blocking error on contract version mismatch (§14.5)', (tester) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            descriptorProvider.overrideWith(() => _MockNotifier(
                  const DescriptorErrorContractMismatch(
                    'Unsupported descriptorContractVersion: "2". Supported version is "1".',
                  ),
                )),
          ],
          child: const MaterialApp(
            home: DynamicDescriptorHomeScreen(autoLoad: false),
          ),
        ),
      );

      await tester.pumpAndSettle();

      expect(find.byKey(const Key('error_contract_mismatch')), findsOneWidget);
      expect(find.text('Descriptor Contract Incompatible'), findsOneWidget);
      expect(
        find.textContaining('Unsupported descriptorContractVersion: "2"'),
        findsOneWidget,
      );
      // No entity forms should be rendered
      expect(find.byType(TextField), findsNothing);
    });

    testWidgets('renders blocking error when required field is missing', (tester) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            descriptorProvider.overrideWith(() => _MockNotifier(
                  const DescriptorErrorMissingField(
                    'DescriptorRoot missing required field: "sourceModelSha256"',
                  ),
                )),
          ],
          child: const MaterialApp(
            home: DynamicDescriptorHomeScreen(autoLoad: false),
          ),
        ),
      );

      await tester.pumpAndSettle();

      expect(find.byKey(const Key('error_missing_field')), findsOneWidget);
      expect(find.text('Descriptor Corrupt or Incomplete'), findsOneWidget);
      expect(find.textContaining('sourceModelSha256'), findsOneWidget);
    });

    testWidgets('renders warning banner when descriptor is stale (§14.3)', (tester) async {
      const sampleDescriptor = DescriptorRoot(
        descriptorContractVersion: '1',
        descriptorVersion: '1.0.0',
        sourceModelId: 'test-model-id',
        sourceModelVersion: '1.0.0',
        sourceModelContractVersion: '1',
        sourceModelSha256: 'old-sha256',
        generatorVersion: '1.0.0',
        classes: [
          ClassDescriptor(
            id: 'cls-01',
            name: 'Libro',
            attributes: [],
          ),
        ],
        associations: [],
      );

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            descriptorProvider.overrideWith(() => _MockNotifier(
                  const DescriptorReady(
                    sampleDescriptor,
                    isStale: true,
                    staleReason: 'Model changed on server.',
                  ),
                )),
          ],
          child: const MaterialApp(
            home: DynamicDescriptorHomeScreen(autoLoad: false),
          ),
        ),
      );

      await tester.pumpAndSettle();

      expect(find.byKey(const Key('banner_stale')), findsOneWidget);
      expect(find.text('Model changed on server.'), findsOneWidget);
    });
  });
}

class _MockNotifier extends DescriptorNotifier {
  final DescriptorState _initialState;

  _MockNotifier(this._initialState);

  @override
  DescriptorState build() => _initialState;

  @override
  Future<void> loadFromAsset(String assetPath, {String? expectedSha256}) async {}
}
