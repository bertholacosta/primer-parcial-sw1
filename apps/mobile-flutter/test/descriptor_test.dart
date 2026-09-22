import 'dart:convert';
import 'dart:io';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_flutter/models/descriptor.dart';
import 'package:mobile_flutter/state/descriptor_state.dart';

void main() {
  group('DescriptorRoot Contract & Parsing', () {
    late String fixtureJson;

    setUpAll(() {
      // Find fixture descriptor from local assets or workspace fixture
      final assetFile = File('assets/flutter-descriptor.json');
      if (assetFile.existsSync()) {
        fixtureJson = assetFile.readAsStringSync();
      } else {
        fixtureJson = File('../../fixtures/generated-projects/biblioteca/flutter-descriptor.json')
            .readAsStringSync();
      }
    });

    test('loads valid fixture descriptor and parses metadata correctly', () {
      final root = DescriptorRoot.fromString(fixtureJson);

      expect(root.descriptorContractVersion, equals('1'));
      expect(root.descriptorVersion, equals('1.0.0'));
      expect(root.sourceModelId, equals('3f2504e0-4f89-11d3-9a0c-0305e82c3301'));
      expect(root.sourceModelVersion, equals('1.0.0'));
      expect(root.sourceModelContractVersion, equals('1'));
      expect(root.sourceModelSha256,
          equals('d73089914b328bda5253583484fd66066123d769b6f40982a272c65902baf483'));
      expect(root.generatorVersion, equals('1.0.0'));

      expect(root.classes.length, equals(2));
      final libro = root.classes.firstWhere((c) => c.name == 'Libro');
      expect(libro.id, equals('cls-01'));
      expect(libro.packageName, equals('biblioteca'));
      expect(libro.attributes.length, equals(3));

      final titulo = libro.attributes.firstWhere((a) => a.name == 'titulo');
      expect(titulo.id, equals('attr-01'));
      expect(titulo.type, equals('String'));
      expect(titulo.uiType, equals('textField'));
      expect(titulo.required, isTrue);
      expect(titulo.nullable, isFalse);

      final fechaPub = libro.attributes.firstWhere((a) => a.name == 'fechaPublicacion');
      expect(fechaPub.id, equals('attr-03'));
      expect(fechaPub.type, equals('Date'));
      expect(fechaPub.uiType, equals('datePicker'));
      expect(fechaPub.required, isFalse);
      expect(fechaPub.nullable, isTrue);

      final autor = root.classes.firstWhere((c) => c.name == 'Autor');
      expect(autor.id, equals('cls-02'));
      expect(autor.attributes.length, equals(1));
      expect(autor.attributes.first.name, equals('nombre'));
      expect(autor.attributes.first.required, isTrue);

      expect(root.associations.length, equals(1));
      final assoc = root.associations.first;
      expect(assoc.id, equals('assoc-01'));
      expect(assoc.name, equals('escritoPor'));
      expect(assoc.sourceClassId, equals('cls-01'));
      expect(assoc.targetClassId, equals('cls-02'));
      expect(assoc.relationType, equals('manyToMany'));
      expect(assoc.isLazyLoadable, isTrue);
    });

    test('rejects unsupported descriptorContractVersion with explicit exception', () {
      final invalidJson = Map<String, dynamic>.from(jsonDecode(fixtureJson) as Map);
      invalidJson['descriptorContractVersion'] = '2';

      expect(
        () => DescriptorRoot.fromJson(invalidJson),
        throwsA(
          isA<DescriptorContractException>()
              .having((e) => e.code, 'code', equals('DESCRIPTOR_CONTRACT_VERSION_MISMATCH'))
              .having((e) => e.message, 'message', contains('descriptorContractVersion: "2"')),
        ),
      );
    });

    test('rejects missing descriptorContractVersion with explicit exception', () {
      final invalidJson = Map<String, dynamic>.from(jsonDecode(fixtureJson) as Map);
      invalidJson.remove('descriptorContractVersion');

      expect(
        () => DescriptorRoot.fromJson(invalidJson),
        throwsA(
          isA<DescriptorContractException>()
              .having((e) => e.code, 'code', equals('DESCRIPTOR_MISSING_REQUIRED_FIELD'))
              .having((e) => e.message, 'message', contains('descriptorContractVersion')),
        ),
      );
    });

    test('rejects missing sourceModelSha256 with explicit exception', () {
      final invalidJson = Map<String, dynamic>.from(jsonDecode(fixtureJson) as Map);
      invalidJson.remove('sourceModelSha256');

      expect(
        () => DescriptorRoot.fromJson(invalidJson),
        throwsA(
          isA<DescriptorContractException>()
              .having((e) => e.code, 'code', equals('DESCRIPTOR_MISSING_REQUIRED_FIELD'))
              .having((e) => e.message, 'message', contains('sourceModelSha256')),
        ),
      );
    });

    test('rejects missing classes array with explicit exception', () {
      final invalidJson = Map<String, dynamic>.from(jsonDecode(fixtureJson) as Map);
      invalidJson.remove('classes');

      expect(
        () => DescriptorRoot.fromJson(invalidJson),
        throwsA(
          isA<DescriptorContractException>()
              .having((e) => e.code, 'code', equals('DESCRIPTOR_MISSING_REQUIRED_FIELD'))
              .having((e) => e.message, 'message', contains('classes')),
        ),
      );
    });

    test('rejects missing attribute required field with explicit exception', () {
      final invalidJson = Map<String, dynamic>.from(jsonDecode(fixtureJson) as Map);
      final rawClasses = (invalidJson['classes'] as List).cast<Map<String, dynamic>>();
      final modifiedClass = Map<String, dynamic>.from(rawClasses.first);
      final rawAttrs = (modifiedClass['attributes'] as List).cast<Map<String, dynamic>>();
      final modifiedAttr = Map<String, dynamic>.from(rawAttrs.first);
      modifiedAttr.remove('uiType');
      modifiedClass['attributes'] = [modifiedAttr];
      invalidJson['classes'] = [modifiedClass];

      expect(
        () => DescriptorRoot.fromJson(invalidJson),
        throwsA(
          isA<DescriptorContractException>()
              .having((e) => e.code, 'code', equals('DESCRIPTOR_MISSING_REQUIRED_FIELD'))
              .having((e) => e.message, 'message', contains('uiType')),
        ),
      );
    });

    test('preserves forward compatibility by ignoring unknown fields (ignore-unknown policy §12)', () {
      final jsonWithUnknown = Map<String, dynamic>.from(jsonDecode(fixtureJson) as Map);
      jsonWithUnknown['futureRootField'] = 'some_future_value';
      final rawClasses = (jsonWithUnknown['classes'] as List).cast<Map<String, dynamic>>();
      final modifiedClass = Map<String, dynamic>.from(rawClasses.first);
      modifiedClass['futureClassField'] = 12345;
      jsonWithUnknown['classes'] = [modifiedClass];

      final root = DescriptorRoot.fromJson(jsonWithUnknown);
      expect(root.classes.first.name, equals('Libro'));
    });
  });

  group('DescriptorNotifier Lifecycle States', () {
    late String fixtureJson;

    setUpAll(() {
      final assetFile = File('assets/flutter-descriptor.json');
      if (assetFile.existsSync()) {
        fixtureJson = assetFile.readAsStringSync();
      } else {
        fixtureJson = File('../../fixtures/generated-projects/biblioteca/flutter-descriptor.json')
            .readAsStringSync();
      }
    });

    test('transitions to DescriptorReady upon valid descriptor string', () {
      final container = ProviderContainer();
      addTearDown(container.dispose);

      expect(container.read(descriptorProvider), isA<DescriptorInitial>());

      container.read(descriptorProvider.notifier).loadFromJsonString(fixtureJson);
      expect(container.read(descriptorProvider), isA<DescriptorReady>());
      final ready = container.read(descriptorProvider) as DescriptorReady;
      expect(ready.isStale, isFalse);
      expect(ready.descriptor.classes.length, equals(2));
    });

    test('transitions to DescriptorReady with isStale when SHA-256 differs', () {
      final container = ProviderContainer();
      addTearDown(container.dispose);

      container.read(descriptorProvider.notifier).loadFromJsonString(
        fixtureJson,
        expectedSha256: 'different_hash_published_by_server',
      );

      expect(container.read(descriptorProvider), isA<DescriptorReady>());
      final ready = container.read(descriptorProvider) as DescriptorReady;
      expect(ready.isStale, isTrue);
      expect(ready.staleReason, contains('DESCRIPTOR_MODEL_MISMATCH'));
    });

    test('transitions to DescriptorErrorContractMismatch when version is incompatible', () {
      final container = ProviderContainer();
      addTearDown(container.dispose);

      final invalidJson = Map<String, dynamic>.from(jsonDecode(fixtureJson) as Map);
      invalidJson['descriptorContractVersion'] = '99';

      container.read(descriptorProvider.notifier).loadFromJsonString(jsonEncode(invalidJson));
      expect(container.read(descriptorProvider), isA<DescriptorErrorContractMismatch>());
      final mismatch = container.read(descriptorProvider) as DescriptorErrorContractMismatch;
      expect(mismatch.message, contains('Unsupported descriptorContractVersion: "99"'));
    });

    test('transitions to DescriptorErrorMissingField when required field is absent', () {
      final container = ProviderContainer();
      addTearDown(container.dispose);

      final invalidJson = Map<String, dynamic>.from(jsonDecode(fixtureJson) as Map);
      invalidJson.remove('sourceModelId');

      container.read(descriptorProvider.notifier).loadFromJsonString(jsonEncode(invalidJson));
      expect(container.read(descriptorProvider), isA<DescriptorErrorMissingField>());
      final err = container.read(descriptorProvider) as DescriptorErrorMissingField;
      expect(err.message, contains('sourceModelId'));
    });

    test('transitions to DescriptorUnavailable when marked unavailable', () {
      final container = ProviderContainer();
      addTearDown(container.dispose);

      container.read(descriptorProvider.notifier).markUnavailable('No network and no local descriptor cached.');
      expect(container.read(descriptorProvider), isA<DescriptorUnavailable>());
    });
  });
}
