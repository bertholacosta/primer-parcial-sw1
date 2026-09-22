import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_flutter/models/descriptor.dart';
import 'package:mobile_flutter/widgets/dynamic_form.dart';

void main() {
  group('DynamicEntityForm Rendering & Validation', () {
    testWidgets('renders fields for Libro dynamically from metadata', (tester) async {
      const libroClass = ClassDescriptor(
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
          AttributeDescriptor(
            id: 'attr-02',
            name: 'isbn',
            type: 'String',
            nullable: false,
            multiplicity: '1',
            uiType: 'textField',
            required: true,
          ),
          AttributeDescriptor(
            id: 'attr-03',
            name: 'fechaPublicacion',
            type: 'Date',
            nullable: true,
            multiplicity: '0..1',
            uiType: 'datePicker',
            required: false,
          ),
        ],
      );

      Map<String, dynamic>? savedValues;

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: DynamicEntityForm(
                classDescriptor: libroClass,
                onSave: (values) => savedValues = values,
              ),
            ),
          ),
        ),
      );

      // Verify fields rendered with appropriate keys
      expect(find.byKey(const Key('field_titulo')), findsOneWidget);
      expect(find.byKey(const Key('field_isbn')), findsOneWidget);
      expect(find.byKey(const Key('field_fechaPublicacion')), findsOneWidget);
      expect(find.byKey(const Key('btn_save_libro')), findsOneWidget);

      // Attempt to save without filling required fields
      await tester.tap(find.byKey(const Key('btn_save_libro')));
      await tester.pumpAndSettle();

      expect(find.text('Field "titulo" is required.'), findsOneWidget);
      expect(find.text('Field "isbn" is required.'), findsOneWidget);
      expect(savedValues, isNull);

      // Enter valid data
      await tester.enterText(find.byKey(const Key('field_titulo')), 'Cien Anos de Soledad');
      await tester.enterText(find.byKey(const Key('field_isbn')), '978-0307474728');
      await tester.enterText(find.byKey(const Key('field_fechaPublicacion')), '1967-05-30');
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('btn_save_libro')));
      await tester.pumpAndSettle();

      expect(savedValues, isNotNull);
      expect(savedValues!['titulo'], equals('Cien Anos de Soledad'));
      expect(savedValues!['isbn'], equals('978-0307474728'));
      expect(savedValues!['fechaPublicacion'], equals('1967-05-30'));
    });

    testWidgets('renders all uiTypes: integerField, decimalField, checkbox, uuidField, unknown', (tester) async {
      const complexClass = ClassDescriptor(
        id: 'cls-complex',
        name: 'Registro',
        attributes: [
          AttributeDescriptor(
            id: 'attr-int',
            name: 'cantidad',
            type: 'Integer',
            nullable: false,
            multiplicity: '1',
            uiType: 'integerField',
            required: true,
          ),
          AttributeDescriptor(
            id: 'attr-dec',
            name: 'precio',
            type: 'Double',
            nullable: false,
            multiplicity: '1',
            uiType: 'decimalField',
            required: true,
          ),
          AttributeDescriptor(
            id: 'attr-bool',
            name: 'activo',
            type: 'Boolean',
            nullable: false,
            multiplicity: '1',
            uiType: 'checkbox',
            required: false,
          ),
          AttributeDescriptor(
            id: 'attr-uuid',
            name: 'identificador',
            type: 'UUID',
            nullable: false,
            multiplicity: '1',
            uiType: 'uuidField',
            required: false,
          ),
          AttributeDescriptor(
            id: 'attr-unknown',
            name: 'campoFuturo',
            type: 'Custom',
            nullable: true,
            multiplicity: '0..1',
            uiType: 'unknownFutureWidget',
            required: false,
          ),
        ],
      );

      Map<String, dynamic>? savedData;

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: DynamicEntityForm(
                classDescriptor: complexClass,
                initialValues: const {'identificador': '123e4567-e89b-12d3-a456-426614174000'},
                onSave: (data) => savedData = data,
              ),
            ),
          ),
        ),
      );

      expect(find.byKey(const Key('field_cantidad')), findsOneWidget);
      expect(find.byKey(const Key('field_precio')), findsOneWidget);
      expect(find.byKey(const Key('field_activo')), findsOneWidget);
      expect(find.byKey(const Key('field_identificador')), findsOneWidget);
      // Fallback for unknown uiType
      expect(find.byKey(const Key('field_campoFuturo')), findsOneWidget);

      // Checkbox toggle
      await tester.tap(find.byKey(const Key('field_activo')));
      await tester.pumpAndSettle();

      // Enter numbers
      await tester.enterText(find.byKey(const Key('field_cantidad')), '42');
      await tester.enterText(find.byKey(const Key('field_precio')), '19.99');
      await tester.enterText(find.byKey(const Key('field_campoFuturo')), 'fallback text');
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('btn_save_registro')));
      await tester.pumpAndSettle();

      expect(savedData, isNotNull);
      expect(savedData!['cantidad'], equals(42));
      expect(savedData!['precio'], equals(19.99));
      expect(savedData!['activo'], isTrue);
      expect(savedData!['identificador'], equals('123e4567-e89b-12d3-a456-426614174000'));
      expect(savedData!['campoFuturo'], equals('fallback text'));
    });

  });
}
