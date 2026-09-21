import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_flutter/models/multimodal_proposal.dart';
import 'package:mobile_flutter/state/onboarding_state.dart';
import 'package:mobile_flutter/widgets/guided_onboarding.dart';

const _validIntent =
    'Crear clase Cliente con id de tipo String obligatorio y email de tipo String opcional';
const _invalidIntent =
    'agregar campo salario de tipo Decimal a la clase Empleado';

ProviderContainer _container() {
  final container = ProviderContainer();
  addTearDown(container.dispose);
  return container;
}

OnboardingNotifier _notifier(ProviderContainer container) =>
    container.read(onboardingProvider.notifier);

void main() {
  group('OnboardingNotifier (flow state machine)', () {
    test('intent produces a reviewable, dry-run validated proposal', () {
      final container = _container();
      final notifier = _notifier(container);

      expect(container.read(onboardingProvider), isA<OnboardingIdle>());

      notifier.submitIntent(_validIntent);

      final state = container.read(onboardingProvider);
      expect(state, isA<OnboardingProposalReady>());
      final ready = state as OnboardingProposalReady;
      expect(ready.proposal.source.modality, ProposalModality.textPrompt);
      expect(ready.proposal.evidences.single.type,
          EvidenceType.textTranscript);
      expect(ready.proposal.dryRunValidation!.status, DryRunStatus.valid);
      expect(ready.proposal.lifecycleState,
          ProposalLifecycleState.awaitingConfirmation);
      expect(ready.selectedCommandIds,
          ready.proposal.proposedCommands.map((c) => c.commandId).toSet());
      expect(ready.canConfirm, isTrue);
      // Review happens before any change: model still empty.
      expect(notifier.domainModel.classes, isEmpty);
    });

    test('valid confirmation applies the commands and resolves the flow',
        () {
      final container = _container();
      final notifier = _notifier(container);
      notifier.submitIntent(_validIntent);

      notifier.confirm(confirmedBy: 'tester');

      final state = container.read(onboardingProvider);
      expect(state, isA<OnboardingResolved>());
      final resolved = state as OnboardingResolved;
      expect(resolved.applied, isTrue);
      expect(resolved.proposal.lifecycleState,
          ProposalLifecycleState.confirmed);
      expect(resolved.proposal.resolution!.action,
          ResolutionAction.confirmAll);
      expect(resolved.proposal.resolution!.resolvedBy, 'tester');
      expect(notifier.domainModel.classes.single.name, 'Cliente');
      expect(notifier.domainModel.classes.single.attributes, hasLength(2));
    });

    test('cancellation rejects the proposal and leaves the model untouched',
        () {
      final container = _container();
      final notifier = _notifier(container);
      notifier.submitIntent(_validIntent);
      final modelBefore = jsonEncode(notifier.domainModel.toJson());

      notifier.cancel(rejectedBy: 'tester');

      final state = container.read(onboardingProvider);
      expect(state, isA<OnboardingResolved>());
      final resolved = state as OnboardingResolved;
      expect(resolved.applied, isFalse);
      expect(resolved.proposal.lifecycleState,
          ProposalLifecycleState.rejected);
      expect(resolved.proposal.resolution!.action, ResolutionAction.reject);
      expect(jsonEncode(notifier.domainModel.toJson()), modelBefore);
    });

    test('invalid proposal cannot be confirmed and never mutates the model',
        () {
      final container = _container();
      final notifier = _notifier(container);
      notifier.submitIntent(_invalidIntent);

      final ready =
          container.read(onboardingProvider) as OnboardingProposalReady;
      expect(ready.isInvalid, isTrue);
      expect(ready.canConfirm, isFalse);
      expect(ready.proposal.dryRunValidation!.status, DryRunStatus.invalid);
      expect(
        ready.proposal.dryRunValidation!.errors.map((e) => e.code),
        contains('UNKNOWN_TYPE'),
      );
      final modelBefore = jsonEncode(notifier.domainModel.toJson());

      // Even if confirm is invoked programmatically, the deterministic
      // gate refuses it (MP-INV-2) and the review stays open.
      notifier.confirm(confirmedBy: 'tester');

      final after = container.read(onboardingProvider);
      expect(after, isA<OnboardingProposalReady>());
      expect(
        (after as OnboardingProposalReady)
            .resolutionErrors
            .map((e) => e.code),
        contains('DETERMINISTIC_PRECONDITION_FAILED'),
      );
      expect(jsonEncode(notifier.domainModel.toJson()), modelBefore);
    });

    test('correction by deselecting commands yields a partial confirmation',
        () {
      final container = _container();
      final notifier = _notifier(container);
      notifier.submitIntent(_validIntent);
      final ready =
          container.read(onboardingProvider) as OnboardingProposalReady;

      // Discard both AddAttribute commands; keep only CreateClass (D6).
      for (final c in ready.proposal.proposedCommands) {
        if (c.type == 'AddAttribute') notifier.toggleCommand(c.commandId);
      }
      notifier.confirm(confirmedBy: 'tester');

      final state = container.read(onboardingProvider);
      expect(state, isA<OnboardingResolved>());
      final resolved = state as OnboardingResolved;
      expect(resolved.applied, isTrue);
      expect(resolved.proposal.lifecycleState,
          ProposalLifecycleState.partiallyConfirmed);
      expect(resolved.proposal.resolution!.action,
          ResolutionAction.confirmSelection);
      expect(resolved.proposal.resolution!.rejectedCommandIds, hasLength(2));
      final cliente = notifier.domainModel.classes.single;
      expect(cliente.name, 'Cliente');
      expect(cliente.attributes, isEmpty);
    });

    test('deselecting a dependent command is refused with diagnostics', () {
      final container = _container();
      final notifier = _notifier(container);
      notifier.submitIntent(_validIntent);
      final ready =
          container.read(onboardingProvider) as OnboardingProposalReady;
      final createId = ready.proposal.proposedCommands
          .firstWhere((c) => c.type == 'CreateClass')
          .commandId;
      final modelBefore = jsonEncode(notifier.domainModel.toJson());

      // Keep the attributes but drop their CreateClass (§8.1 rule 3).
      notifier.toggleCommand(createId);
      notifier.confirm(confirmedBy: 'tester');

      final state = container.read(onboardingProvider);
      expect(state, isA<OnboardingProposalReady>());
      expect(
        (state as OnboardingProposalReady)
            .resolutionErrors
            .map((e) => e.code),
        contains('INVALID_COMMAND_SELECTION'),
      );
      expect(jsonEncode(notifier.domainModel.toJson()), modelBefore);
    });

    test('restart returns the flow to the intent step', () {
      final container = _container();
      final notifier = _notifier(container);
      notifier.submitIntent(_validIntent);
      notifier.cancel();

      notifier.reset();

      expect(container.read(onboardingProvider), isA<OnboardingIdle>());
    });
  });

  group('GuidedOnboardingScreen (widget flow)', () {
    Future<ProviderContainer> pumpScreen(WidgetTester tester) async {
      final container = ProviderContainer();
      addTearDown(container.dispose);
      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: const MaterialApp(home: GuidedOnboardingScreen()),
        ),
      );
      await tester.pumpAndSettle();
      return container;
    }

    Future<void> submitIntent(WidgetTester tester, String intent) async {
      await tester.enterText(
          find.byKey(const Key('onboarding_intent_input')), intent);
      await tester.tap(find.byKey(const Key('onboarding_generate')));
      await tester.pumpAndSettle();
    }

    testWidgets('intent → review → valid confirmation applies the proposal',
        (tester) async {
      final container = await pumpScreen(tester);
      expect(find.byKey(const Key('onboarding_step_intent')), findsOneWidget);

      await submitIntent(tester, _validIntent);

      // Review step: proposal summary, dry-run banner and command list.
      expect(find.byKey(const Key('onboarding_step_review')), findsOneWidget);
      expect(find.byKey(const Key('onboarding_proposal_summary')),
          findsOneWidget);
      expect(find.byKey(const Key('onboarding_dryrun_valid')), findsOneWidget);
      expect(find.byKey(const Key('proposal_command_0')), findsOneWidget);
      expect(find.byKey(const Key('proposal_command_2')), findsOneWidget);

      await tester.tap(find.byKey(const Key('onboarding_confirm')));
      await tester.pumpAndSettle();

      expect(
          find.byKey(const Key('onboarding_result_confirmed')), findsOneWidget);
      final notifier = _notifier(container);
      expect(notifier.domainModel.classes.single.name, 'Cliente');
    });

    testWidgets('cancellation rejects the proposal before any change',
        (tester) async {
      final container = await pumpScreen(tester);
      final notifier = _notifier(container);
      await submitIntent(tester, _validIntent);
      final modelBefore = jsonEncode(notifier.domainModel.toJson());

      await tester.tap(find.byKey(const Key('onboarding_cancel')));
      await tester.pumpAndSettle();

      expect(
          find.byKey(const Key('onboarding_result_rejected')), findsOneWidget);
      expect(jsonEncode(notifier.domainModel.toJson()), modelBefore);
      final state = container.read(onboardingProvider);
      expect((state as OnboardingResolved).proposal.lifecycleState,
          ProposalLifecycleState.rejected);
    });

    testWidgets('invalid proposal shows diagnostics and disables confirm',
        (tester) async {
      final container = await pumpScreen(tester);
      final notifier = _notifier(container);
      await submitIntent(tester, _invalidIntent);
      final modelBefore = jsonEncode(notifier.domainModel.toJson());

      expect(find.byKey(const Key('onboarding_dryrun_invalid')),
          findsOneWidget);
      expect(find.textContaining('UNKNOWN_TYPE'), findsWidgets);
      final confirmButton = tester
          .widget<ElevatedButton>(find.byKey(const Key('onboarding_confirm')));
      expect(confirmButton.onPressed, isNull);

      // The only exit from an invalid proposal is cancellation.
      await tester.tap(find.byKey(const Key('onboarding_cancel')));
      await tester.pumpAndSettle();
      expect(
          find.byKey(const Key('onboarding_result_rejected')), findsOneWidget);
      expect(jsonEncode(notifier.domainModel.toJson()), modelBefore);
    });

    testWidgets('deselecting a command produces a partial confirmation',
        (tester) async {
      final container = await pumpScreen(tester);
      await submitIntent(tester, _validIntent);

      // Discard the 'email' attribute command, keep the rest.
      await tester.ensureVisible(find.byKey(const Key('proposal_command_2')));
      await tester.tap(find.byKey(const Key('proposal_command_2')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('onboarding_confirm')));
      await tester.pumpAndSettle();

      expect(
        find.byKey(const Key('onboarding_result_partially_confirmed')),
        findsOneWidget,
      );
      final cliente = _notifier(container).domainModel.classes.single;
      expect(cliente.attributes.single.name, 'id');
    });
  });
}
