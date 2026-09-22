import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_flutter/models/domain_model.dart';
import 'package:mobile_flutter/services/local_interpreter.dart';

DomainModel _model() => DomainModel.fromJson({
      'contractVersion': '1',
      'id': 'model-tienda-01',
      'name': 'Tienda',
      'version': '1.0.0',
      'packages': [],
      'classes': [
        {
          'id': 'cls-cliente',
          'name': 'Cliente',
          'attributes': [
            {
              'id': 'attr-cliente-id',
              'name': 'id',
              'type': 'String',
              'nullable': false,
              'multiplicity': '1'
            }
          ]
        }
      ],
      'associations': [],
    });

const _slmOutput = '''
{"intentSummary": "Agregar el atributo 'email' de tipo 'String' a la clase 'Cliente'",
 "commands": [
   {"type": "AddAttribute",
    "payload": {"id": "attr-cliente-email", "classId": "cls-cliente",
                "name": "email", "type": "String",
                "nullable": true, "multiplicity": "0..1"},
    "score": 0.93,
    "fieldScores": {"name": 0.95, "type": 0.98, "nullable": 0.86}}
 ]}''';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('SlmPromptBuilder', () {
    test('el prompt incluye el metamodelo, el snapshot del modelo y la '
        'transcripción', () {
      final prompt = SlmPromptBuilder.build(
        InterpretationRequest(
          transcript: 'agregar email de tipo String a Cliente',
          model: _model(),
        ),
      );

      expect(prompt, contains('agregar email de tipo String a Cliente'));
      expect(prompt, contains('CreateClass'));
      expect(prompt, contains('AddAttribute'));
      expect(prompt, contains('CreateAssociation'));
      expect(prompt, contains('String, Integer, Long, Double'));
      expect(prompt, contains('"modelId":"model-tienda-01"'));
      expect(prompt, contains('"name":"Cliente"'));
      expect(prompt, contains('cls-cliente'));
    });
  });

  group('InterpretationResult.parse', () {
    test('parsea comandos con puntuaciones del SLM', () {
      final result = InterpretationResult.parse(_slmOutput);

      expect(result.intentSummary, contains('email'));
      expect(result.commands, hasLength(1));
      final cmd = result.commands.single;
      expect(cmd.type, 'AddAttribute');
      expect(cmd.payload['classId'], 'cls-cliente');
      expect(cmd.payload['type'], 'String');
      expect(cmd.score, 0.93);
      expect(cmd.fieldScores['nullable'], 0.86);
    });

    test('tolera texto extraño alrededor del objeto JSON', () {
      final result = InterpretationResult.parse(
        'seguro, aquí está: $_slmOutput\nEspero que sirva.',
      );
      expect(result.commands, hasLength(1));
    });

    test('salida sin JSON → PROPOSED_COMMAND_SYNTAX_ERROR', () {
      expect(
        () => InterpretationResult.parse('no entiendo la solicitud'),
        throwsA(isA<InterpretationException>().having(
          (e) => e.code,
          'code',
          LocalInterpretationErrorCodes.proposedCommandSyntaxError,
        )),
      );
    });

    test('JSON sin arreglo commands → PROPOSED_COMMAND_SYNTAX_ERROR', () {
      expect(
        () => InterpretationResult.parse('{"intentSummary": "nada"}'),
        throwsA(isA<InterpretationException>().having(
          (e) => e.code,
          'code',
          LocalInterpretationErrorCodes.proposedCommandSyntaxError,
        )),
      );
    });

    test('comando sin payload → PROPOSED_COMMAND_SYNTAX_ERROR', () {
      expect(
        () => InterpretationResult.parse(
            '{"commands": [{"type": "CreateClass"}]}'),
        throwsA(isA<InterpretationException>().having(
          (e) => e.code,
          'code',
          LocalInterpretationErrorCodes.proposedCommandSyntaxError,
        )),
      );
    });

    test('las puntuaciones se acotan a [0.0, 1.0] con valor por defecto', () {
      final result = InterpretationResult.parse(
        '{"commands": [{"type": "CreateClass", "payload": {}, '
        '"score": 7.5, "fieldScores": {"name": -2}}]}',
      );
      expect(result.commands.single.score, 1.0);
      expect(result.commands.single.fieldScores['name'], 0.0);
    });
  });

  group('LlamaChannelInterpreter', () {
    const interpreter = LlamaChannelInterpreter();
    final messenger =
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;

    tearDown(() {
      messenger.setMockMethodCallHandler(kLocalSlmChannel, null);
    });

    test('sin backend nativo isAvailable es falso (degradación controlada)',
        () async {
      messenger.setMockMethodCallHandler(kLocalSlmChannel, (call) async {
        if (call.method == 'isAvailable') return false;
        return null;
      });
      expect(await interpreter.isAvailable(), isFalse);
    });

    test('generate devuelve texto y latencia del bridge', () async {
      messenger.setMockMethodCallHandler(kLocalSlmChannel, (call) async {
        if (call.method == 'isAvailable') return true;
        if (call.method == 'generate') {
          expect(call.arguments['maxTokens'], kSlmMaxTokens);
          expect(call.arguments['prompt'] as String,
              contains('agregar email'));
          return {'text': _slmOutput, 'elapsedMs': 3400};
        }
        return null;
      });

      final result = await interpreter.interpret(
        InterpretationRequest(
          transcript: 'agregar email de tipo String a Cliente',
          model: _model(),
        ),
      );

      expect(result.commands.single.type, 'AddAttribute');
      expect(result.elapsedMs, 3400);
      expect(result.rawOutput, isNotNull);
    });

    test('PlatformException se mapea a un diagnóstico del catálogo', () async {
      messenger.setMockMethodCallHandler(kLocalSlmChannel, (call) async {
        throw PlatformException(
          code: 'SLM_UNAVAILABLE',
          message: 'libllama_jni.so no enlazada.',
        );
      });

      expect(
        () => interpreter.interpret(
          InterpretationRequest(transcript: 'hola', model: _model()),
        ),
        throwsA(isA<InterpretationException>().having(
          (e) => e.code,
          'code',
          LocalInterpretationErrorCodes.slmUnavailable,
        )),
      );
    });

    test('salida nativa vacía → NO_COMMANDS_GENERATED', () async {
      messenger.setMockMethodCallHandler(kLocalSlmChannel, (call) async {
        if (call.method == 'generate') return {'text': '   '};
        return true;
      });

      expect(
        () => interpreter.interpret(
          InterpretationRequest(transcript: 'hola', model: _model()),
        ),
        throwsA(isA<InterpretationException>().having(
          (e) => e.code,
          'code',
          LocalInterpretationErrorCodes.noCommandsGenerated,
        )),
      );
    });
  });
}
