import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_flutter/models/domain_model.dart';
import 'package:mobile_flutter/models/multimodal_proposal.dart';
import 'package:mobile_flutter/services/local_interpreter.dart';
import 'package:mobile_flutter/services/local_speech_recognizer.dart';
import 'package:mobile_flutter/services/voice_input_pipeline.dart';
import 'package:mobile_flutter/services/voice_proposal_adapter.dart';

/// Corpus de locuciones del banco de pruebas de ADR-0005 (§2).
const _locutionT1 =
    'Crear clase Cliente con id de tipo String obligatorio y email de tipo String opcional';
const _locutionT2 =
    'Crear clase Factura y clase DetalleFactura con asociación unidireccional de uno a muchos';
const _locutionT3 =
    'Agregar a Cuenta los atributos saldo de tipo Double y activa de tipo Boolean con multiplicidad uno';
const _locutionT5 =
    'Hola buenos días por favor dibuja una casa con un árbol';

/// Presupuesto de latencia end-to-end del ADR-0005: el ciclo completo
/// desde el fin de la captura hasta la propuesta en pantalla debe ser
/// inferior a 5.0 s en el dispositivo de referencia. En la compuerta
/// offline en CI el SLM es un doble determinista, por lo que el mismo
/// presupuesto se aplica holgadamente a la orquestación.
const _adrLatencyBudgetMs = 5000;

DomainModel _tiendaModel({List<Map<String, dynamic>> classes = const []}) =>
    DomainModel.fromJson({
      'contractVersion': '1',
      'id': 'model-tienda-01',
      'name': 'Tienda',
      'version': '1.0.0',
      'packages': [],
      'classes': classes,
      'associations': [],
    });

/// Fully on-device recognizer fake: pure Dart, no platform channel, no
/// network — equivalent to the airplane-mode execution path.
class _FakeRecognizer implements LocalSpeechRecognizer {
  String transcript = '';

  @override
  Future<bool> isAvailable() async => true;

  @override
  Future<SpeechTranscript> transcribe(SpeechAudio audio) async =>
      SpeechTranscript(text: transcript, startMs: 0, endMs: audio.durationMs);
}

/// On-device SLM fake: deterministic, pure Dart, no network. Scripted
/// outputs stand in for the llama.cpp/Qwen2.5 extraction so the whole
/// interpretation scenario is exercised offline in CI.
class _FakeInterpreter implements LocalInterpreter {
  _FakeInterpreter({this.available = true});

  final bool available;
  InterpretationException? nextFailure;
  final Map<String, InterpretationResult> scripted = {};
  int interpretCalls = 0;

  @override
  Future<bool> isAvailable() async => available;

  @override
  Future<InterpretationResult> interpret(InterpretationRequest request) async {
    interpretCalls++;
    if (nextFailure != null) throw nextFailure!;
    return scripted[request.transcript] ??
        const InterpretationResult(
          intentSummary: 'Sin intención reconocida por el SLM.',
          commands: [],
        );
  }
}

/// Two seconds of PCM16 mono silence at 16 kHz.
SpeechAudio _audio() =>
    SpeechAudio(pcmBytes: Uint8List(kAsrSampleRateHz * 2 * 2));

InterpretationResult _slm(String summary, List<InterpretedCommand> commands,
        {int elapsedMs = 3400, int tokens = 110}) =>
    InterpretationResult(
      intentSummary: summary,
      commands: commands,
      elapsedMs: elapsedMs,
      generatedTokens: tokens,
      rawOutput: '{"intentSummary": "$summary"}',
    );

void main() {
  late _FakeRecognizer recognizer;
  late _FakeInterpreter interpreter;
  late VoiceProposalService service;

  setUp(() {
    recognizer = _FakeRecognizer();
    interpreter = _FakeInterpreter();
    service = VoiceProposalService(
      recognizer: recognizer,
      interpreter: interpreter,
    );
  });

  group('escenario de interpretación local ADR-0005 (offline)', () {
    test('T1: clase con atributos → propuesta confirmable con evidencia '
        'SLM + audio', () async {
      recognizer.transcript = _locutionT1;
      interpreter.scripted[_locutionT1] = _slm(
        "Crear la clase 'Cliente' con los atributos 'id' (String "
        'obligatorio) y ' "'email' (String opcional)",
        [
          const InterpretedCommand(
            type: 'CreateClass',
            payload: {'id': 'cls-cliente', 'name': 'Cliente', 'isAbstract': false},
            score: 0.97,
            fieldScores: {'name': 0.98},
          ),
          const InterpretedCommand(
            type: 'AddAttribute',
            payload: {
              'id': 'attr-cliente-id',
              'classId': 'cls-cliente',
              'name': 'id',
              'type': 'String',
              'nullable': false,
              'multiplicity': '1'
            },
            score: 0.95,
          ),
          const InterpretedCommand(
            type: 'AddAttribute',
            payload: {
              'id': 'attr-cliente-email',
              'classId': 'cls-cliente',
              'name': 'email',
              'type': 'String',
              'nullable': true,
              'multiplicity': '0..1'
            },
            score: 0.90,
          ),
        ],
      );
      final model = _tiendaModel();
      final before = jsonEncode(model.toJson());
      final audio = _audio();
      final sw = Stopwatch()..start();

      final proposal =
          await service.proposeFromAudio(model: model, audio: audio);
      sw.stop();

      // Propuesta contractual: validada en dry-run y pendiente de
      // confirmación humana (MP-INV-2 / MP-INV-3).
      expect(proposal.lifecycleState,
          ProposalLifecycleState.awaitingConfirmation);
      expect(proposal.dryRunValidation!.status, DryRunStatus.valid);
      expect(proposal.proposedCommands, hasLength(3));
      expect(proposal.source.agentRole, 'android-qwen2.5-slm-local');
      expect(proposal.source.modality, ProposalModality.voice);

      // Evidencias: segmento de audio con hash del buffer + rationale de
      // inferencia con la latencia registrada (MP-INV-4, presupuesto).
      expect(proposal.evidences, hasLength(2));
      expect(proposal.evidences[0].type, EvidenceType.audioSegment);
      expect(proposal.evidences[0].mediaSha256, audio.sha256Hex);
      expect(proposal.evidences[1].type, EvidenceType.inferenceRationale);
      expect(proposal.evidences[1].payload.description, contains('3400 ms'));

      // Sin mutación directa: el modelo sigue byte-idéntico (MP-INV-1).
      expect(jsonEncode(model.toJson()), before);

      // Presupuesto de latencia del escenario (ADR-0005 < 5.0 s).
      expect(sw.elapsedMilliseconds, lessThan(_adrLatencyBudgetMs));

      // Solo la confirmación explícita muta el modelo.
      final outcome = VoiceProposalAdapter().confirm(
        proposal: proposal,
        model: model,
        confirmedBy: 'docente-evaluador',
      );
      expect(outcome.applied, isTrue);
      expect(model.classes.single.name, 'Cliente');
      expect(model.classes.single.attributes, hasLength(2));
      expect(interpreter.interpretCalls, 1);
    });

    test('T2: dos clases y asociación → comandos topológicamente '
        'ordenados y válidos', () async {
      recognizer.transcript = _locutionT2;
      interpreter.scripted[_locutionT2] = _slm(
        "Crear 'Factura' y 'DetalleFactura' con asociación de 1 a muchos",
        [
          const InterpretedCommand(
            type: 'CreateClass',
            payload: {'id': 'cls-factura', 'name': 'Factura'},
            score: 0.96,
          ),
          const InterpretedCommand(
            type: 'CreateClass',
            payload: {'id': 'cls-detalle', 'name': 'DetalleFactura'},
            score: 0.94,
          ),
          const InterpretedCommand(
            type: 'CreateAssociation',
            payload: {
              'id': 'assoc-factura-detalle',
              'sourceClassId': 'cls-factura',
              'targetClassId': 'cls-detalle',
              'sourceMultiplicity': '1',
              'targetMultiplicity': '1..*',
              'navigability': 'unidirectional'
            },
            score: 0.82,
          ),
        ],
      );
      final model = _tiendaModel();

      final proposal =
          await service.proposeFromAudio(model: model, audio: _audio());

      expect(proposal.dryRunValidation!.status, DryRunStatus.valid);
      expect(proposal.proposedCommands.map((c) => c.type), [
        'CreateClass',
        'CreateClass',
        'CreateAssociation',
      ]);
      expect(proposal.confidence.level, ConfidenceLevel.high);
      expect(model.classes, isEmpty); // nada muta antes de confirmar
    });

    test('T3: atributos sobre clase existente → el SLM referencia el id '
        'real del snapshot del modelo', () async {
      recognizer.transcript = _locutionT3;
      interpreter.scripted[_locutionT3] = _slm(
        "Agregar 'saldo' (Double) y 'activa' (Boolean) a 'Cuenta'",
        [
          const InterpretedCommand(
            type: 'AddAttribute',
            payload: {
              'id': 'attr-cuenta-saldo',
              'classId': 'cls-cuenta-01',
              'name': 'saldo',
              'type': 'Double',
              'nullable': false,
              'multiplicity': '1'
            },
            score: 0.91,
          ),
          const InterpretedCommand(
            type: 'AddAttribute',
            payload: {
              'id': 'attr-cuenta-activa',
              'classId': 'cls-cuenta-01',
              'name': 'activa',
              'type': 'Boolean',
              'nullable': false,
              'multiplicity': '1'
            },
            score: 0.90,
          ),
        ],
      );
      final model = _tiendaModel(classes: [
        {
          'id': 'cls-cuenta-01',
          'name': 'Cuenta',
          'isAbstract': false,
          'attributes': []
        }
      ]);

      final proposal =
          await service.proposeFromAudio(model: model, audio: _audio());

      expect(proposal.dryRunValidation!.status, DryRunStatus.valid);
      expect(proposal.proposedCommands, hasLength(2));
      expect(
        proposal.proposedCommands
            .every((c) => c.payload['classId'] == 'cls-cuenta-01'),
        isTrue,
      );
    });

    test('T5: fuera de dominio → INVALID con NO_COMMANDS_GENERATED y '
        'modelo intacto', () async {
      recognizer.transcript = _locutionT5;
      interpreter.scripted[_locutionT5] = _slm(
        'La locución no contiene intención de modelado UML.',
        const [],
      );
      final model = _tiendaModel();
      final before = jsonEncode(model.toJson());

      final proposal =
          await service.proposeFromAudio(model: model, audio: _audio());

      expect(proposal.lifecycleState,
          ProposalLifecycleState.dryRunValidated);
      expect(proposal.dryRunValidation!.status, DryRunStatus.invalid);
      expect(
        proposal.dryRunValidation!.errors.map((e) => e.code),
        contains('NO_COMMANDS_GENERATED'),
      );
      expect(jsonEncode(model.toJson()), before);

      // La compuerta determinista rechaza la confirmación (MP-INV-2).
      final outcome = VoiceProposalAdapter().confirm(
        proposal: proposal,
        model: model,
        confirmedBy: 'docente-evaluador',
      );
      expect(outcome.applied, isFalse);
      expect(
        outcome.errors.map((e) => e.code),
        contains('DETERMINISTIC_PRECONDITION_FAILED'),
      );
      expect(jsonEncode(model.toJson()), before);
    });

    test('alucinación del SLM (tipo Decimal) queda atrapada por el '
        'dry-run determinista', () async {
      recognizer.transcript =
          'agregar campo salario de tipo Decimal a la clase Empleado';
      interpreter.scripted[recognizer.transcript] = _slm(
        "Agregar 'salario' de tipo 'Decimal' a 'Empleado'",
        [
          const InterpretedCommand(
            type: 'AddAttribute',
            payload: {
              'id': 'attr-emp-salario',
              'classId': 'cls-empleado-01',
              'name': 'salario',
              'type': 'Decimal',
              'nullable': false,
              'multiplicity': '1'
            },
            score: 0.72,
          ),
        ],
      );
      final model = _tiendaModel(classes: [
        {
          'id': 'cls-empleado-01',
          'name': 'Empleado',
          'isAbstract': false,
          'attributes': []
        }
      ]);
      final before = jsonEncode(model.toJson());

      final proposal =
          await service.proposeFromAudio(model: model, audio: _audio());

      expect(proposal.dryRunValidation!.status, DryRunStatus.invalid);
      expect(
        proposal.dryRunValidation!.errors.map((e) => e.code),
        contains('UNKNOWN_TYPE'),
      );
      expect(jsonEncode(model.toJson()), before);
    });

    test('SLM no disponible → degradación determinista (mismo escenario '
        'offline, agentRole whisper)', () async {
      interpreter = _FakeInterpreter(available: false);
      service = VoiceProposalService(
        recognizer: recognizer,
        interpreter: interpreter,
      );
      recognizer.transcript = _locutionT1;

      final proposal =
          await service.proposeFromAudio(model: _tiendaModel(), audio: _audio());

      expect(proposal.source.agentRole, 'android-whisper-local');
      expect(proposal.dryRunValidation!.status, DryRunStatus.valid);
      expect(proposal.proposedCommands, hasLength(3));
      expect(interpreter.interpretCalls, 0);
    });

    test('fallo del SLM → propuesta INVALID auditable con la '
        'transcripción preservada como evidencia', () async {
      recognizer.transcript = _locutionT1;
      interpreter.nextFailure = const InterpretationException(
        LocalInterpretationErrorCodes.slmUnavailable,
        'libllama_jni.so no enlazada o modelo ausente.',
      );
      final model = _tiendaModel();
      final before = jsonEncode(model.toJson());
      final audio = _audio();

      final proposal =
          await service.proposeFromAudio(model: model, audio: audio);

      expect(proposal.lifecycleState,
          ProposalLifecycleState.dryRunValidated);
      expect(proposal.dryRunValidation!.errors.single.code,
          'SLM_UNAVAILABLE');
      expect(proposal.evidences.single.type, EvidenceType.audioSegment);
      expect(proposal.evidences.single.mediaSha256, audio.sha256Hex);
      expect(proposal.evidences.single.payload.textTranscript, _locutionT1);
      expect(jsonEncode(model.toJson()), before);
    });

    test('proposeFromTranscript usa el SLM para prompts de texto '
        '(modality text_prompt)', () async {
      interpreter.scripted[_locutionT1] = _slm(
        "Crear la clase 'Cliente' con dos atributos",
        [
          const InterpretedCommand(
            type: 'CreateClass',
            payload: {'id': 'cls-cliente', 'name': 'Cliente'},
            score: 0.96,
          ),
        ],
      );
      final model = _tiendaModel();
      final before = jsonEncode(model.toJson());

      final proposal = await service.proposeFromTranscript(
        model: model,
        transcript: _locutionT1,
      );

      expect(proposal.source.modality, ProposalModality.textPrompt);
      expect(proposal.source.agentRole, 'android-qwen2.5-slm-local');
      expect(proposal.evidences.first.type, EvidenceType.textTranscript);
      expect(proposal.dryRunValidation!.status, DryRunStatus.valid);
      expect(jsonEncode(model.toJson()), before);
    });
  });
}
