import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/descriptor.dart';

/// Sealed class representing the lifecycle states of the descriptor
/// according to flutter-descriptor-v1 §14.1.
sealed class DescriptorState {
  const DescriptorState();
}

/// Initial uninitialized state.
class DescriptorInitial extends DescriptorState {
  const DescriptorInitial();
}

/// Descriptor is currently being fetched/loaded.
class DescriptorLoading extends DescriptorState {
  const DescriptorLoading();
}

/// Descriptor loaded successfully and verified. Complete dynamic UI available.
class DescriptorReady extends DescriptorState {
  final DescriptorRoot descriptor;
  final bool isStale;
  final String? staleReason;

  const DescriptorReady(
    this.descriptor, {
    this.isStale = false,
    this.staleReason,
  });
}

/// Blocking error: descriptor contract version is unsupported (§8.2, §14.5).
class DescriptorErrorContractMismatch extends DescriptorState {
  final String message;
  final String? actualVersion;

  const DescriptorErrorContractMismatch(this.message, {this.actualVersion});
}

/// Blocking error: required field is missing in the descriptor document.
class DescriptorErrorMissingField extends DescriptorState {
  final String message;

  const DescriptorErrorMissingField(this.message);
}

/// Blocking error: descriptor is unavailable and offline with no local cache.
class DescriptorUnavailable extends DescriptorState {
  final String message;

  const DescriptorUnavailable(this.message);
}

/// Riverpod notifier managing descriptor lifecycle transitions.
class DescriptorNotifier extends Notifier<DescriptorState> {
  @override
  DescriptorState build() => const DescriptorInitial();

  /// Loads and parses descriptor directly from a JSON string.
  void loadFromJsonString(String jsonContent, {String? expectedSha256}) {
    state = const DescriptorLoading();
    try {
      final descriptor = DescriptorRoot.fromString(jsonContent);
      if (expectedSha256 != null &&
          descriptor.sourceModelSha256 != expectedSha256) {
        state = DescriptorReady(
          descriptor,
          isStale: true,
          staleReason:
              'DESCRIPTOR_MODEL_MISMATCH: SHA-256 does not match active server model metadata.',
        );
      } else {
        state = DescriptorReady(descriptor);
      }
    } on DescriptorContractException catch (e) {
      if (e.code == 'DESCRIPTOR_CONTRACT_VERSION_MISMATCH') {
        state = DescriptorErrorContractMismatch(e.message);
      } else if (e.code == 'DESCRIPTOR_MISSING_REQUIRED_FIELD') {
        state = DescriptorErrorMissingField(e.message);
      } else {
        state = DescriptorUnavailable(e.message);
      }
    } catch (e) {
      state = DescriptorUnavailable('Failed to parse descriptor: $e');
    }
  }

  /// Loads and parses descriptor from a Flutter asset path.
  Future<void> loadFromAsset(String assetPath, {String? expectedSha256}) async {
    state = const DescriptorLoading();
    try {
      final jsonContent = await rootBundle.loadString(assetPath);
      loadFromJsonString(jsonContent, expectedSha256: expectedSha256);
    } catch (e) {
      state = DescriptorUnavailable('Descriptor asset not found or unreadable: $assetPath');
    }
  }

  /// Sets unavailable state when no connectivity and no cached descriptor.
  void markUnavailable(String reason) {
    state = DescriptorUnavailable(reason);
  }
}

/// Global provider for the descriptor lifecycle state.
final descriptorProvider =
    NotifierProvider<DescriptorNotifier, DescriptorState>(DescriptorNotifier.new);
