import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_flutter/models/domain_model.dart';
import 'package:mobile_flutter/models/multimodal_proposal.dart';
import 'package:mobile_flutter/services/voice_proposal_adapter.dart';

DomainModel _emptyTiendaModel() => DomainModel.fromJson({
      'contractVersion': '1',
      'id': 'model-tienda-01',
      'name': 'Tienda',
      'version': '1.0.0',
      'packages': [
        {'id': 'pkg-01', 'name': 'tienda'}
      ],
      'classes': [],
      'associations': [],
    });

DomainModel _empleadoModel() => DomainModel.fromJson({
      'contractVersion': '1',
      'id': 'model-tienda-01',
      'name': 'Tienda',
      'version': '1.0.1',
      'packages': [],
      'classes': [
        {
          'id': 'cls-empleado-01',
          'name': 'Empleado',
          'attributes': []
        }
      ],
      'associations': [],
    });

void main() {
  // The adapter under test is pure Dart: no network, no audio capture.
  late VoiceProposalAdapter adapter;

  setUp(() {
    adapter = VoiceProposalAdapter();
  });

  group('proposal generation from injected transcript', () {
    test('test transcript produces expected proposal with source and confidence',
        () {
      const transcript =
          'Crear clase Cliente con id de tipo String obligatorio y email de tipo String opcional';
      final model = _emptyTiendaModel();

      final proposal = adapter.propose(model: model, transcript: transcript);

      // Origin metadata (§3.1.1).
      expect(proposal.source.modality, ProposalModality.voice);
      expect(proposal.source.clientPlatform, 'android');
      expect(proposal.source.agentRole, isNotEmpty);
      expect(proposal.source.capturedAt.millisecondsSinceEpoch, greaterThan(0));
      expect(proposal.modelId, 'model-tienda-01');
      expect(proposal.targetModelVersion, '1.0.0');

      // Confidence (§3.1.2): HIGH level with per-command breakdown.
      expect(proposal.confidence.level, ConfidenceLevel.high);
      expect(proposal.confidence.overall, greaterThanOrEqualTo(0.85));
      expect(proposal.confidence.breakdown, hasLength(3));
      expect(
        proposal.confidence.breakdown.map((b) => b.commandIndex),
        [0, 1, 2],
      );

      // Proposed commands mirror contract example §9.1.
      final commands = proposal.proposedCommands;
      expect(commands, hasLength(3));
      expect(commands[0].type, 'CreateClass');
      expect(commands[0].payload['name'], 'Cliente');
      expect(commands[0].payload['id'], 'cls-cliente');
      expect(commands[1].type, 'AddAttribute');
      expect(commands[1].payload['classId'], 'cls-cliente');
      expect(commands[1].payload['name'], 'id');
      expect(commands[1].payload['type'], 'String');
      expect(commands[1].payload['nullable'], isFalse);
      expect(commands[1].payload['multiplicity'], '1');
      expect(commands[2].type, 'AddAttribute');
      expect(commands[2].payload['name'], 'email');
      expect(commands[2].payload['nullable'], isTrue);
      expect(commands[2].payload['multiplicity'], '0..1');

      // Evidence: audio segment with SHA-256 of the injected transcript
      // and the raw transcript preserved (§3.1.3, §5.1.2, MP-INV-4).
      expect(proposal.evidences, hasLength(1));
      final evidence = proposal.evidences.first;
      expect(evidence.type, EvidenceType.audioSegment);
      expect(
        evidence.mediaSha256,
        sha256.convert(utf8.encode(transcript)).toString(),
      );
      expect(evidence.payload.textTranscript, transcript);

      // Mandatory dry-run gate passed → awaiting user confirmation.
      expect(proposal.dryRunValidation, isNotNull);
      expect(proposal.dryRunValidation!.status, DryRunStatus.valid);
      expect(proposal.dryRunValidation!.errors, isEmpty);
      expect(proposal.lifecycleState,
          ProposalLifecycleState.awaitingConfirmation);
      expect(proposal.resolution, isNull);

      // Contract JSON shape (§3).
      final json = proposal.toJson();
      expect(json['contractVersion'], '1.0.0');
      expect(json['lifecycleState'], 'awaiting_confirmation');
      expect(json['source']['modality'], 'voice');
      expect(json['confidence']['level'], 'HIGH');
      expect(json['proposedCommands'][0]['type'], 'CreateClass');
      expect(json['resolution'], isNull);
    });

    test('association intent produces CreateAssociation (1 a muchos)', () {
      final model = _emptyTiendaModel();
      final proposal = adapter.propose(
        model: model,
        transcript:
            'Crear clase Cliente. Crear clase Pedido. Un Cliente tiene muchos Pedidos.',
      );

      expect(proposal.proposedCommands, hasLength(3));
      final assoc = proposal.proposedCommands[2];
      expect(assoc.type, 'CreateAssociation');
      expect(assoc.payload['sourceClassId'], 'cls-cliente');
      // Spoken plural "Pedidos" resolves to created class "Pedido".
      expect(assoc.payload['targetClassId'], 'cls-pedido');
      expect(assoc.payload['sourceMultiplicity'], '1');
      expect(assoc.payload['targetMultiplicity'], '1..*');
      expect(assoc.payload['navigability'], 'unidirectional');
      expect(proposal.dryRunValidation!.status, DryRunStatus.valid);
    });

    test('unrecognized transcript yields INVALID proposal without commands',
        () {
      final model = _emptyTiendaModel();
      final proposal = adapter.propose(
        model: model,
        transcript: 'hola, qué clima hace hoy',
      );

      expect(proposal.proposedCommands, isEmpty);
      expect(proposal.dryRunValidation!.status, DryRunStatus.invalid);
      expect(
        proposal.dryRunValidation!.errors.map((e) => e.code),
        contains('INTENT_UNRECOGNIZED'),
      );
      expect(proposal.confidence.level, ConfidenceLevel.low);
      expect(proposal.lifecycleState,
          ProposalLifecycleState.dryRunValidated);
    });

    test('unsupported type is caught by the deterministic dry-run '
        '(contract example §9.3)', () {
      final model = _empleadoModel();
      final proposal = adapter.propose(
        model: model,
        transcript:
            'agregar campo salario de tipo Decimal a la clase Empleado',
      );

      expect(proposal.proposedCommands, hasLength(1));
      expect(proposal.proposedCommands[0].type, 'AddAttribute');
      expect(proposal.proposedCommands[0].payload['classId'],
          'cls-empleado-01');
      expect(proposal.dryRunValidation!.status, DryRunStatus.invalid);
      expect(proposal.dryRunValidation!.errors, hasLength(1));
      expect(proposal.dryRunValidation!.errors[0].code, 'UNKNOWN_TYPE');
      expect(proposal.dryRunValidation!.errors[0].commandIndex, 0);
      expect(proposal.lifecycleState,
          ProposalLifecycleState.dryRunValidated);
      // Dry-run must not mutate the model.
      expect(model.classes.single.attributes, isEmpty);
      expect(model.version, '1.0.1');
    });
  });

  group('confirmation requires deterministic validation', () {
    test('confirm on INVALID proposal is refused and does not mutate', () {
      final model = _empleadoModel();
      final before = jsonEncode(model.toJson());
      final proposal = adapter.propose(
        model: model,
        transcript:
            'agregar campo salario de tipo Decimal a la clase Empleado',
      );

      final outcome = adapter.confirm(
        proposal: proposal,
        model: model,
        confirmedBy: 'user-test',
      );

      expect(outcome.applied, isFalse);
      expect(
        outcome.errors.map((e) => e.code),
        contains('DETERMINISTIC_PRECONDITION_FAILED'),
      );
      expect(jsonEncode(model.toJson()), before);
      expect(model.version, '1.0.1');
    });

    test('confirm_all applies commands atomically and confirms proposal', () {
      final model = _emptyTiendaModel();
      final proposal = adapter.propose(
        model: model,
        transcript:
            'Crear clase Cliente con id de tipo String obligatorio y email de tipo String opcional',
      );

      final outcome = adapter.confirm(
        proposal: proposal,
        model: model,
        confirmedBy: 'docente-evaluador',
      );

      expect(outcome.applied, isTrue);
      expect(outcome.errors, isEmpty);

      final cliente = model.classes.single;
      expect(cliente.name, 'Cliente');
      expect(cliente.attributes, hasLength(2));
      expect(cliente.attributes[0].name, 'id');
      expect(cliente.attributes[1].name, 'email');
      // Three accepted commands → three PATCH increments.
      expect(model.version, '1.0.3');

      expect(outcome.proposal.lifecycleState,
          ProposalLifecycleState.confirmed);
      expect(outcome.proposal.resolution, isNotNull);
      expect(outcome.proposal.resolution!.action,
          ResolutionAction.confirmAll);
      expect(outcome.proposal.resolution!.resolvedBy, 'docente-evaluador');
      expect(outcome.proposal.resolution!.acceptedCommandIds,
          proposal.proposedCommands.map((c) => c.commandId).toList());
      expect(outcome.proposal.resolution!.rejectedCommandIds, isEmpty);
    });

    test('confirm on stale model version expires the proposal', () {
      final model = _emptyTiendaModel();
      final proposal = adapter.propose(
        model: model,
        transcript: 'Crear clase Cliente',
      );

      // Concurrent edit moved the model forward (§4: expired).
      model.bumpPatch();
      final before = jsonEncode(model.toJson());

      final outcome = adapter.confirm(
        proposal: proposal,
        model: model,
        confirmedBy: 'user-test',
      );

      expect(outcome.applied, isFalse);
      expect(
        outcome.errors.map((e) => e.code),
        contains('PROPOSAL_EXPIRED'),
      );
      expect(outcome.proposal.lifecycleState, ProposalLifecycleState.expired);
      expect(jsonEncode(model.toJson()), before);
    });

    test('partial confirmation requires referential integrity', () {
      final model = _emptyTiendaModel();
      final proposal = adapter.propose(
        model: model,
        transcript:
            'Crear clase Cliente con id de tipo String obligatorio y email de tipo String opcional',
      );
      final attributeIds = proposal.proposedCommands
          .where((c) => c.type == 'AddAttribute')
          .map((c) => c.commandId)
          .toList();
      final before = jsonEncode(model.toJson());

      // Selecting AddAttribute without its CreateClass is refused (§8.1 r.3).
      final outcome = adapter.confirm(
        proposal: proposal,
        model: model,
        confirmedBy: 'user-test',
        selectedCommandIds: attributeIds,
      );

      expect(outcome.applied, isFalse);
      expect(
        outcome.errors.map((e) => e.code),
        contains('INVALID_COMMAND_SELECTION'),
      );
      expect(jsonEncode(model.toJson()), before);
    });

    test('partial confirmation applies only the selected subset', () {
      final model = _emptyTiendaModel();
      final proposal = adapter.propose(
        model: model,
        transcript:
            'Crear clase Cliente con id de tipo String obligatorio y email de tipo String opcional',
      );
      final createId = proposal.proposedCommands
          .firstWhere((c) => c.type == 'CreateClass')
          .commandId;

      final outcome = adapter.confirm(
        proposal: proposal,
        model: model,
        confirmedBy: 'user-test',
        selectedCommandIds: [createId],
      );

      expect(outcome.applied, isTrue);
      expect(model.classes.single.name, 'Cliente');
      expect(model.classes.single.attributes, isEmpty);
      expect(model.version, '1.0.1');
      expect(outcome.proposal.lifecycleState,
          ProposalLifecycleState.partiallyConfirmed);
      expect(outcome.proposal.resolution!.rejectedCommandIds, hasLength(2));
    });
  });

  group('rejection never alters the model', () {
    test('reject transitions state and leaves the model byte-identical', () {
      final model = _emptyTiendaModel();
      final proposal = adapter.propose(
        model: model,
        transcript:
            'Crear clase Cliente con id de tipo String obligatorio y email de tipo String opcional',
      );
      final before = jsonEncode(model.toJson());

      final outcome = adapter.reject(
        proposal: proposal,
        rejectedBy: 'user-aober',
        reason: 'La interpretación no fue la esperada.',
      );

      expect(outcome.applied, isFalse);
      expect(outcome.errors, isEmpty);
      expect(outcome.proposal.lifecycleState, ProposalLifecycleState.rejected);
      expect(outcome.proposal.resolution!.action, ResolutionAction.reject);
      expect(outcome.proposal.resolution!.rejectionReason,
          'La interpretación no fue la esperada.');
      expect(jsonEncode(model.toJson()), before);
      expect(model.version, '1.0.0');
    });

    test('rejecting an INVALID proposal is allowed (contract example §9.3)',
        () {
      final model = _empleadoModel();
      final proposal = adapter.propose(
        model: model,
        transcript:
            'agregar campo salario de tipo Decimal a la clase Empleado',
      );

      final outcome = adapter.reject(
        proposal: proposal,
        rejectedBy: 'user-aober',
        reason: 'Tipo Decimal no permitido; repetiré indicando Double.',
      );

      expect(outcome.proposal.lifecycleState, ProposalLifecycleState.rejected);
      expect(model.classes.single.attributes, isEmpty);
    });

    test('a resolved proposal cannot be confirmed nor rejected again', () {
      final model = _emptyTiendaModel();
      final proposal = adapter.propose(
        model: model,
        transcript: 'Crear clase Cliente',
      );
      final rejected =
          adapter.reject(proposal: proposal, rejectedBy: 'u').proposal;

      final confirmOutcome = adapter.confirm(
        proposal: rejected,
        model: model,
        confirmedBy: 'u',
      );
      expect(confirmOutcome.applied, isFalse);
      expect(
        confirmOutcome.errors.map((e) => e.code),
        contains('PROPOSAL_ALREADY_RESOLVED'),
      );

      final rejectOutcome =
          adapter.reject(proposal: rejected, rejectedBy: 'u');
      expect(
        rejectOutcome.errors.map((e) => e.code),
        contains('PROPOSAL_ALREADY_RESOLVED'),
      );
    });
  });
}
