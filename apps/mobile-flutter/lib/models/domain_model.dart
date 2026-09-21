/// Canonical domain model document (domain-model-v1 §3).
///
/// Used by the multimodal proposal subsystem as the in-memory target for the
/// deterministic dry-run validation and for confirmed command dispatch
/// (multimodal-proposals-v1 MP-INV-1/MP-INV-2, model-commands-v1).
library;

/// Attribute of a canonical class (domain-model-v1 §3.4).
class DomainAttribute {
  String id;
  String name;
  String type;
  bool nullable;
  String multiplicity;
  String? description;

  DomainAttribute({
    required this.id,
    required this.name,
    required this.type,
    required this.nullable,
    required this.multiplicity,
    this.description,
  });

  factory DomainAttribute.fromJson(Map<String, dynamic> json) {
    return DomainAttribute(
      id: json['id'] as String,
      name: json['name'] as String,
      type: json['type'] as String,
      nullable: json['nullable'] as bool,
      multiplicity: json['multiplicity'] as String,
      description: json['description'] as String?,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'type': type,
        'nullable': nullable,
        'multiplicity': multiplicity,
        if (description != null) 'description': description,
      };
}

/// Canonical class (domain-model-v1 §3.3).
class DomainClass {
  String id;
  String name;
  String? packageId;
  bool isAbstract;
  String? description;
  List<DomainAttribute> attributes;

  DomainClass({
    required this.id,
    required this.name,
    this.packageId,
    this.isAbstract = false,
    this.description,
    List<DomainAttribute>? attributes,
  }) : attributes = attributes ?? [];

  factory DomainClass.fromJson(Map<String, dynamic> json) {
    return DomainClass(
      id: json['id'] as String,
      name: json['name'] as String,
      packageId: json['packageId'] as String?,
      isAbstract: json['isAbstract'] as bool? ?? false,
      description: json['description'] as String?,
      attributes: (json['attributes'] as List<dynamic>? ?? const [])
          .map((a) => DomainAttribute.fromJson(a as Map<String, dynamic>))
          .toList(),
    );
  }

  DomainAttribute? attributeById(String attributeId) {
    for (final attr in attributes) {
      if (attr.id == attributeId) return attr;
    }
    return null;
  }

  bool hasAttributeNamed(String name, {String? excludeId}) {
    return attributes.any((a) => a.name == name && a.id != excludeId);
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        if (packageId != null) 'packageId': packageId,
        'isAbstract': isAbstract,
        if (description != null) 'description': description,
        'attributes': attributes.map((a) => a.toJson()).toList(),
      };
}

/// Canonical association (domain-model-v1 §3.7).
class DomainAssociation {
  String id;
  String? name;
  String sourceClassId;
  String targetClassId;
  String sourceMultiplicity;
  String targetMultiplicity;
  String navigability;
  String? description;

  DomainAssociation({
    required this.id,
    this.name,
    required this.sourceClassId,
    required this.targetClassId,
    required this.sourceMultiplicity,
    required this.targetMultiplicity,
    required this.navigability,
    this.description,
  });

  factory DomainAssociation.fromJson(Map<String, dynamic> json) {
    return DomainAssociation(
      id: json['id'] as String,
      name: json['name'] as String?,
      sourceClassId: json['sourceClassId'] as String,
      targetClassId: json['targetClassId'] as String,
      sourceMultiplicity: json['sourceMultiplicity'] as String,
      targetMultiplicity: json['targetMultiplicity'] as String,
      navigability: json['navigability'] as String,
      description: json['description'] as String?,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        if (name != null) 'name': name,
        'sourceClassId': sourceClassId,
        'targetClassId': targetClassId,
        'sourceMultiplicity': sourceMultiplicity,
        'targetMultiplicity': targetMultiplicity,
        'navigability': navigability,
        if (description != null) 'description': description,
      };
}

/// Canonical package (domain-model-v1 §3.2).
class DomainPackage {
  String id;
  String name;
  String? parentId;
  String? description;

  DomainPackage({
    required this.id,
    required this.name,
    this.parentId,
    this.description,
  });

  factory DomainPackage.fromJson(Map<String, dynamic> json) {
    return DomainPackage(
      id: json['id'] as String,
      name: json['name'] as String,
      parentId: json['parentId'] as String?,
      description: json['description'] as String?,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        if (parentId != null) 'parentId': parentId,
        if (description != null) 'description': description,
      };
}

/// Root document of the canonical model (domain-model-v1 §3.1).
class DomainModel {
  static const String supportedContractVersion = '1';

  /// Valid identifier pattern for names (domain-model-v1 §2.5/§3).
  static final RegExp namePattern = RegExp(r'^[A-Za-z_][A-Za-z0-9_]*$');

  /// Allowed attribute type literals (domain-model-v1 §3.5).
  static const Set<String> allowedTypes = {
    'String',
    'Integer',
    'Long',
    'Double',
    'Boolean',
    'Date',
    'DateTime',
    'UUID',
  };

  /// Allowed multiplicity literals (domain-model-v1 §3.6).
  static const Set<String> allowedMultiplicities = {'1', '0..1', '1..*', '0..*'};

  /// Allowed navigability literals (domain-model-v1 §3.7).
  static const Set<String> allowedNavigabilities = {
    'unidirectional',
    'bidirectional',
  };

  String contractVersion;
  String id;
  String name;
  String version;
  String? description;
  List<DomainPackage> packages;
  List<DomainClass> classes;
  List<DomainAssociation> associations;

  DomainModel({
    this.contractVersion = supportedContractVersion,
    required this.id,
    required this.name,
    required this.version,
    this.description,
    List<DomainPackage>? packages,
    List<DomainClass>? classes,
    List<DomainAssociation>? associations,
  })  : packages = packages ?? [],
        classes = classes ?? [],
        associations = associations ?? [];

  factory DomainModel.fromJson(Map<String, dynamic> json) {
    return DomainModel(
      contractVersion:
          json['contractVersion'] as String? ?? supportedContractVersion,
      id: json['id'] as String,
      name: json['name'] as String,
      version: json['version'] as String,
      description: json['description'] as String?,
      packages: (json['packages'] as List<dynamic>? ?? const [])
          .map((p) => DomainPackage.fromJson(p as Map<String, dynamic>))
          .toList(),
      classes: (json['classes'] as List<dynamic>? ?? const [])
          .map((c) => DomainClass.fromJson(c as Map<String, dynamic>))
          .toList(),
      associations: (json['associations'] as List<dynamic>? ?? const [])
          .map((a) => DomainAssociation.fromJson(a as Map<String, dynamic>))
          .toList(),
    );
  }

  Map<String, dynamic> toJson() => {
        'contractVersion': contractVersion,
        'id': id,
        'name': name,
        'version': version,
        if (description != null) 'description': description,
        'packages': packages.map((p) => p.toJson()).toList(),
        'classes': classes.map((c) => c.toJson()).toList(),
        'associations': associations.map((a) => a.toJson()).toList(),
      };

  /// Deep copy through the canonical JSON representation.
  DomainModel clone() => DomainModel.fromJson(toJson());

  /// Replaces this document's content with [other]'s (used to commit an
  /// atomically validated batch; `id` is preserved as model identity).
  void copyFrom(DomainModel other) {
    contractVersion = other.contractVersion;
    name = other.name;
    version = other.version;
    description = other.description;
    packages = other.packages;
    classes = other.classes;
    associations = other.associations;
  }

  /// Increments the PATCH component of the semver `version`
  /// (model-commands-v1 §2.2, domain-model-v1 S1).
  void bumpPatch() {
    final parts = version.split('.');
    if (parts.length == 3) {
      final patch = int.tryParse(parts[2]) ?? 0;
      version = '${parts[0]}.${parts[1]}.${patch + 1}';
    }
  }

  DomainClass? classById(String classId) {
    for (final c in classes) {
      if (c.id == classId) return c;
    }
    return null;
  }

  /// Case-insensitive lookup used by the voice adapter to resolve spoken
  /// class names against the current model.
  DomainClass? classByNameInsensitive(String name) {
    final lowered = name.toLowerCase();
    for (final c in classes) {
      if (c.name.toLowerCase() == lowered) return c;
    }
    return null;
  }

  DomainPackage? packageById(String packageId) {
    for (final p in packages) {
      if (p.id == packageId) return p;
    }
    return null;
  }

  DomainAssociation? associationById(String associationId) {
    for (final a in associations) {
      if (a.id == associationId) return a;
    }
    return null;
  }

  /// Whether any attribute in the document uses [attributeId]
  /// (model-commands-v1 §2.4 document-wide id uniqueness).
  bool attributeIdExists(String attributeId) {
    return classes.any((c) => c.attributes.any((a) => a.id == attributeId));
  }
}
