import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_flutter/models/domain_model.dart';
import 'package:mobile_flutter/models/model_command.dart';
import 'package:mobile_flutter/models/multimodal_proposal.dart';
import 'package:mobile_flutter/services/image_proposal_adapter.dart';

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

const _mediaHash =
    '4a5b6c7d8e9f0123456789abcdef0123456789abcdef0123456789abcdef0123';

/// Structured interpretation mirroring contract example §9.2: a
/// whiteboard sketch with `Factura` and `DetalleFactura` joined by a
/// unidirectional 1 → 1..* connector, plus one attribute line.
ImageInterpretation _facturaSketch() => const ImageInterpretation(
      mediaSha256: _mediaHash,
      caption: 'Foto de pizarra capturada desde cámara web',
      classes: [
        DetectedClassBox(
          name: 'Factura',
          confidence: 0.95,
          boundingBox:
              BoundingBox(ymin: 0.15, xmin: 0.10, ymax: 0.45, xmax: 0.40),
          attributes: [
            DetectedAttributeLine(
              name: 'numero',
              type: 'Integer',
              nullable: false,
              multiplicity: '1',
              confidence: 0.90,
              boundingBox: BoundingBox(
                  ymin: 0.25, xmin: 0.12, ymax: 0.30, xmax: 0.38),
            ),
          ],
        ),
        DetectedClassBox(
          name: 'DetalleFactura',
          confidence: 0.92,
          boundingBox:
              BoundingBox(ymin: 0.15, xmin: 0.60, ymax: 0.45, xmax: 0.90),
        ),
      ],
      connectors: [
        DetectedConnector(
          label: 'detalles',
          sourceClassName: 'Factura',
          targetClassName: 'DetalleFactura',
          sourceMultiplicity: '1',
          targetMultiplicity: '1..*',
          navigability: 'unidirectional',
          confidence: 0.77,
          boundingBox:
              BoundingBox(ymin: 0.28, xmin: 0.40, ymax: 0.32, xmax: 0.60),
        ),
      ],
    );

void main() {
  // The adapter under test is pure Dart: no image capture, no vision
  // engine; it only converts an injected structured interpretation.
  late ImageProposalAdapter adapter;

  setUp(() {
    adapter = ImageProposalAdapter();
  });

  group('proposal generation from injected interpretation', () {
    test('test interpretation produces traceable proposal for the '
        'minimum cut (contract example §9.2)', () {
      final model = _emptyTiendaModel();
      final before = jsonEncode(model.toJson());

      final proposal =
          adapter.propose(model: model, interpretation: _facturaSketch());

      // Origin metadata (§3.1.1).
      expect(proposal.source.modality, ProposalModality.image);
      expect(proposal.source.clientPlatform, 'android');
      expect(proposal.source.agentRole, isNotEmpty);
      expect(proposal.source.capturedAt.millisecondsSinceEpoch,
          greaterThan(0));
      expect(proposal.modelId, 'model-tienda-01');
      expect(proposal.targetModelVersion, '1.0.0');

      // Proposed commands in topological order (§3.1.4): both
      // CreateClass precede AddAttribute and CreateAssociation.
      final commands = proposal.proposedCommands;
      expect(commands.map((c) => c.type), [
        'CreateClass',
        'CreateClass',
        'AddAttribute',
        'CreateAssociation',
      ]);
      expect(commands[0].payload['name'], 'Factura');
      expect(commands[0].payload['id'], 'cls-factura');
      expect(commands[1].payload['name'], 'DetalleFactura');
      expect(commands[1].payload['id'], 'cls-detallefactura');
      expect(commands[2].payload['classId'], 'cls-factura');
      expect(commands[2].payload['name'], 'numero');
      expect(commands[2].payload['type'], 'Integer');
      expect(commands[2].payload['nullable'], isFalse);
      expect(commands[2].payload['multiplicity'], '1');
      expect(commands[3].payload['name'], 'detalles');
      expect(commands[3].payload['sourceClassId'], 'cls-factura');
      expect(commands[3].payload['targetClassId'], 'cls-detallefactura');
      expect(commands[3].payload['sourceMultiplicity'], '1');
      expect(commands[3].payload['targetMultiplicity'], '1..*');
      expect(commands[3].payload['navigability'], 'unidirectional');

      // Evidence: one bounding_box per detected element, all sharing the
      // image hash (§5.2.2, MP-INV-4/MP-INV-5).
      expect(proposal.evidences, hasLength(4));
      for (final evidence in proposal.evidences) {
        expect(evidence.type, EvidenceType.boundingBox);
        expect(evidence.mediaSha256, _mediaHash);
        expect(evidence.payload.boundingBox, isNotNull);
      }
      final firstBox = proposal.evidences.first.payload.boundingBox!;
      expect(firstBox.ymin, 0.15);
      expect(firstBox.xmin, 0.10);
      expect(firstBox.ymax, 0.45);
      expect(firstBox.xmax, 0.40);

      // Confidence breakdown covers every proposed command (§3.1.2).
      expect(
        proposal.confidence.breakdown.map((b) => b.commandIndex),
        [0, 1, 2, 3],
      );
      expect(proposal.confidence.overall, greaterThan(0.0));

      // Mandatory dry-run gate passed → awaiting user confirmation.
      expect(proposal.dryRunValidation, isNotNull);
      expect(proposal.dryRunValidation!.status, DryRunStatus.valid);
      expect(proposal.dryRunValidation!.errors, isEmpty);
      expect(proposal.lifecycleState,
          ProposalLifecycleState.awaitingConfirmation);
      expect(proposal.resolution, isNull);

      // MP-INV-1: proposing never mutates the canonical model.
      expect(jsonEncode(model.toJson()), before);
      expect(model.version, '1.0.0');

      // Contract JSON shape (§3).
      final json = proposal.toJson();
      expect(json['contractVersion'], '1.0.0');
      expect(json['lifecycleState'], 'awaiting_confirmation');
      expect(json['source']['modality'], 'image');
      expect(json['evidences'][0]['type'], 'bounding_box');
      expect(json['evidences'][0]['payload']['boundingBox']['ymin'],
          0.15);
      expect(json['proposedCommands'][3]['type'], 'CreateAssociation');
      expect(json['resolution'], isNull);
    });

    test('connector resolves endpoints against existing model classes',
        () {
      final model = _emptyTiendaModel();
      final proposal = adapter.propose(
        model: model,
        interpretation: const ImageInterpretation(
          mediaSha256: _mediaHash,
          classes: [
            DetectedClassBox(
              name: 'Pedido',
              confidence: 0.9,
              boundingBox:
                  BoundingBox(ymin: 0.1, xmin: 0.1, ymax: 0.3, xmax: 0.4),
            ),
          ],
          connectors: [
            DetectedConnector(
              sourceClassName: 'Pedido',
              // "Facturas" resolves to created class "Factura"? No: only
              // "Pedido" was detected, so this endpoint must fall back to
              // the slug and be flagged by the dry-run.
              targetClassName: 'Inexistente',
              sourceMultiplicity: '1',
              targetMultiplicity: '0..*',
              navigability: 'unidirectional',
              confidence: 0.8,
              boundingBox:
                  BoundingBox(ymin: 0.2, xmin: 0.4, ymax: 0.25, xmax: 0.6),
            ),
          ],
        ),
      );

      expect(proposal.proposedCommands, hasLength(2));
      expect(proposal.dryRunValidation!.status, DryRunStatus.invalid);
      expect(
        proposal.dryRunValidation!.errors.map((e) => e.code),
        contains('CLASS_NOT_FOUND'),
      );
      expect(proposal.lifecycleState,
          ProposalLifecycleState.dryRunValidated);
      expect(model.classes, isEmpty);
      expect(model.version, '1.0.0');
    });

    test('empty interpretation yields INTENT_UNRECOGNIZED and no commands',
        () {
      final model = _emptyTiendaModel();
      final proposal = adapter.propose(
        model: model,
        interpretation: const ImageInterpretation(mediaSha256: _mediaHash),
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

    test('interpretation without media hash is hashed for auditability',
        () {
      final model = _emptyTiendaModel();
      const interpretation = ImageInterpretation(
        classes: [
          DetectedClassBox(
            name: 'Factura',
            confidence: 0.9,
            boundingBox:
                BoundingBox(ymin: 0.1, xmin: 0.1, ymax: 0.3, xmax: 0.4),
          ),
        ],
      );

      final proposal =
          adapter.propose(model: model, interpretation: interpretation);

      expect(
        proposal.evidences.single.mediaSha256,
        sha256
            .convert(utf8.encode(jsonEncode(interpretation.toJson())))
            .toString(),
      );
    });
  });

  group('incomplete data produces non-blocking warnings', () {
    test('illegible and partial detections warn but keep the proposal '
        'confirmable and never mutate the model', () {
      final model = _emptyTiendaModel();
      final before = jsonEncode(model.toJson());

      final proposal = adapter.propose(
        model: model,
        interpretation: const ImageInterpretation(
          mediaSha256: _mediaHash,
          classes: [
            DetectedClassBox(
              name: 'Producto',
              confidence: 0.9,
              boundingBox:
                  BoundingBox(ymin: 0.1, xmin: 0.1, ymax: 0.4, xmax: 0.4),
              attributes: [
                // nullable/multiplicity illegible → assumed + warned.
                DetectedAttributeLine(
                    name: 'precio', type: 'Double', confidence: 0.8),
                // type illegible → attribute omitted + warned.
                DetectedAttributeLine(name: 'stock', confidence: 0.7),
              ],
            ),
            // Illegible header → whole box omitted + warned.
            DetectedClassBox(
              confidence: 0.4,
              boundingBox:
                  BoundingBox(ymin: 0.5, xmin: 0.5, ymax: 0.8, xmax: 0.8),
            ),
          ],
          connectors: [
            // Missing target endpoint → connector omitted + warned.
            DetectedConnector(
              sourceClassName: 'Producto',
              confidence: 0.6,
              boundingBox:
                  BoundingBox(ymin: 0.45, xmin: 0.4, ymax: 0.5, xmax: 0.6),
            ),
          ],
        ),
      );

      // Only the fully legible elements produce commands.
      expect(proposal.proposedCommands.map((c) => c.type),
          ['CreateClass', 'AddAttribute']);
      expect(proposal.proposedCommands[1].payload['name'], 'precio');
      // Conservative defaults were assumed for the illegible fields.
      expect(proposal.proposedCommands[1].payload['nullable'], isFalse);
      expect(proposal.proposedCommands[1].payload['multiplicity'], '1');

      // Every gap surfaced as a non-blocking warning.
      final warnings = proposal.dryRunValidation!.warnings;
      expect(warnings, hasLength(5));
      expect(
        warnings.every((w) => w.severity == DiagnosticSeverity.warning),
        isTrue,
      );
      expect(warnings.map((w) => w.code).toSet(),
          {ImageProposalAdapter.incompleteDetectionCode});

      // WARNINGS still passes the dry-run gate → confirmable.
      expect(proposal.dryRunValidation!.status, DryRunStatus.warnings);
      expect(proposal.dryRunValidation!.errors, isEmpty);
      expect(proposal.lifecycleState,
          ProposalLifecycleState.awaitingConfirmation);

      // MP-INV-1: the model was never touched.
      expect(jsonEncode(model.toJson()), before);
      expect(model.version, '1.0.0');
    });

    test('interpretation with only illegible detections yields '
        'NO_COMMANDS_GENERATED', () {
      final model = _emptyTiendaModel();
      final proposal = adapter.propose(
        model: model,
        interpretation: const ImageInterpretation(
          mediaSha256: _mediaHash,
          classes: [
            DetectedClassBox(
              confidence: 0.3,
              boundingBox:
                  BoundingBox(ymin: 0.1, xmin: 0.1, ymax: 0.3, xmax: 0.4),
            ),
          ],
        ),
      );

      expect(proposal.proposedCommands, isEmpty);
      expect(proposal.dryRunValidation!.status, DryRunStatus.invalid);
      expect(
        proposal.dryRunValidation!.errors.map((e) => e.code),
        contains('NO_COMMANDS_GENERATED'),
      );
      expect(proposal.dryRunValidation!.warnings, isNotEmpty);
      expect(model.classes, isEmpty);
      expect(model.version, '1.0.0');
    });
  });

  group('proposal lifecycle', () {
    test('confirm_all applies image commands atomically', () {
      final model = _emptyTiendaModel();
      final proposal =
          adapter.propose(model: model, interpretation: _facturaSketch());

      final outcome = adapter.confirm(
        proposal: proposal,
        model: model,
        confirmedBy: 'docente-evaluador',
      );

      expect(outcome.applied, isTrue);
      expect(outcome.errors, isEmpty);
      expect(model.classes.map((c) => c.name),
          ['Factura', 'DetalleFactura']);
      expect(model.classes[0].attributes.single.name, 'numero');
      expect(model.associations.single.name, 'detalles');
      expect(model.associations.single.sourceClassId, 'cls-factura');
      // Four accepted commands → four PATCH increments.
      expect(model.version, '1.0.4');
      expect(outcome.proposal.lifecycleState,
          ProposalLifecycleState.confirmed);
      expect(outcome.proposal.resolution!.action,
          ResolutionAction.confirmAll);
    });

    test('confirm on INVALID proposal is refused and does not mutate', () {
      final model = _emptyTiendaModel();
      final proposal = adapter.propose(
        model: model,
        interpretation: const ImageInterpretation(
          mediaSha256: _mediaHash,
          classes: [
            DetectedClassBox(
              name: '9Ilegible',
              confidence: 0.9,
              boundingBox:
                  BoundingBox(ymin: 0.1, xmin: 0.1, ymax: 0.3, xmax: 0.4),
            ),
          ],
        ),
      );
      // '9Ilegible' violates the name pattern → INVALID_NAME_FORMAT.
      expect(proposal.dryRunValidation!.status, DryRunStatus.invalid);

      final before = jsonEncode(model.toJson());
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
    });

    test('reject leaves the model byte-identical', () {
      final model = _emptyTiendaModel();
      final proposal =
          adapter.propose(model: model, interpretation: _facturaSketch());
      final before = jsonEncode(model.toJson());

      final outcome = adapter.reject(
        proposal: proposal,
        rejectedBy: 'user-aober',
        reason: 'La interpretación no fue la esperada.',
      );

      expect(outcome.applied, isFalse);
      expect(outcome.proposal.lifecycleState,
          ProposalLifecycleState.rejected);
      expect(outcome.proposal.resolution!.rejectionReason,
          'La interpretación no fue la esperada.');
      expect(jsonEncode(model.toJson()), before);
      expect(model.version, '1.0.0');
    });
  });
}
