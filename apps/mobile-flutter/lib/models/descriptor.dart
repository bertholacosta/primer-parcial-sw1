import 'dart:convert';

/// Exception thrown when descriptor contract invariants or validations fail.
class DescriptorContractException implements Exception {
  final String code;
  final String message;

  const DescriptorContractException({
    required this.code,
    required this.message,
  });

  @override
  String toString() => 'DescriptorContractException($code): $message';
}

/// Representation of an attribute in the Flutter descriptor contract v1.
class AttributeDescriptor {
  final String id;
  final String name;
  final String type;
  final bool nullable;
  final String multiplicity;
  final String uiType;
  final bool required;
  final String? description;

  const AttributeDescriptor({
    required this.id,
    required this.name,
    required this.type,
    required this.nullable,
    required this.multiplicity,
    required this.uiType,
    required this.required,
    this.description,
  });

  factory AttributeDescriptor.fromJson(Map<String, dynamic> json) {
    void requireField(String field) {
      if (!json.containsKey(field) || json[field] == null) {
        throw DescriptorContractException(
          code: 'DESCRIPTOR_MISSING_REQUIRED_FIELD',
          message: 'AttributeDescriptor missing required field: "$field"',
        );
      }
    }

    requireField('id');
    requireField('name');
    requireField('type');
    requireField('nullable');
    requireField('multiplicity');
    requireField('uiType');
    requireField('required');

    return AttributeDescriptor(
      id: json['id'] as String,
      name: json['name'] as String,
      type: json['type'] as String,
      nullable: json['nullable'] as bool,
      multiplicity: json['multiplicity'] as String,
      uiType: json['uiType'] as String,
      required: json['required'] as bool,
      description: json['description'] as String?,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'type': type,
        'nullable': nullable,
        'multiplicity': multiplicity,
        'uiType': uiType,
        'required': required,
        if (description != null) 'description': description,
      };
}

/// Representation of an association in the Flutter descriptor contract v1.
class AssociationDescriptor {
  final String id;
  final String? name;
  final String sourceClassId;
  final String targetClassId;
  final String sourceMultiplicity;
  final String targetMultiplicity;
  final String navigability;
  final String relationType;
  final bool isLazyLoadable;
  final String? description;

  const AssociationDescriptor({
    required this.id,
    this.name,
    required this.sourceClassId,
    required this.targetClassId,
    required this.sourceMultiplicity,
    required this.targetMultiplicity,
    required this.navigability,
    required this.relationType,
    required this.isLazyLoadable,
    this.description,
  });

  factory AssociationDescriptor.fromJson(Map<String, dynamic> json) {
    void requireField(String field) {
      if (!json.containsKey(field) || json[field] == null) {
        throw DescriptorContractException(
          code: 'DESCRIPTOR_MISSING_REQUIRED_FIELD',
          message: 'AssociationDescriptor missing required field: "$field"',
        );
      }
    }

    requireField('id');
    requireField('sourceClassId');
    requireField('targetClassId');
    requireField('sourceMultiplicity');
    requireField('targetMultiplicity');
    requireField('navigability');
    requireField('relationType');
    requireField('isLazyLoadable');

    return AssociationDescriptor(
      id: json['id'] as String,
      name: json['name'] as String?,
      sourceClassId: json['sourceClassId'] as String,
      targetClassId: json['targetClassId'] as String,
      sourceMultiplicity: json['sourceMultiplicity'] as String,
      targetMultiplicity: json['targetMultiplicity'] as String,
      navigability: json['navigability'] as String,
      relationType: json['relationType'] as String,
      isLazyLoadable: json['isLazyLoadable'] as bool,
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
        'relationType': relationType,
        'isLazyLoadable': isLazyLoadable,
        if (description != null) 'description': description,
      };
}

/// Representation of a class in the Flutter descriptor contract v1.
class ClassDescriptor {
  final String id;
  final String name;
  final String? packageName;
  final bool isAbstract;
  final String? description;
  final List<AttributeDescriptor> attributes;

  const ClassDescriptor({
    required this.id,
    required this.name,
    this.packageName,
    required this.isAbstract,
    this.description,
    required this.attributes,
  });

  factory ClassDescriptor.fromJson(Map<String, dynamic> json) {
    void requireField(String field) {
      if (!json.containsKey(field) || json[field] == null) {
        throw DescriptorContractException(
          code: 'DESCRIPTOR_MISSING_REQUIRED_FIELD',
          message: 'ClassDescriptor missing required field: "$field"',
        );
      }
    }

    requireField('id');
    requireField('name');
    requireField('isAbstract');
    requireField('attributes');

    final rawAttrs = json['attributes'] as List<dynamic>;
    final attributes = rawAttrs
        .map((attr) => AttributeDescriptor.fromJson(attr as Map<String, dynamic>))
        .toList();

    return ClassDescriptor(
      id: json['id'] as String,
      name: json['name'] as String,
      packageName: json['packageName'] as String?,
      isAbstract: json['isAbstract'] as bool,
      description: json['description'] as String?,
      attributes: attributes,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        if (packageName != null) 'packageName': packageName,
        'isAbstract': isAbstract,
        if (description != null) 'description': description,
        'attributes': attributes.map((a) => a.toJson()).toList(),
      };
}

/// Root document of the flutter-descriptor.json contract v1.
class DescriptorRoot {
  static const String supportedContractVersion = '1';

  final String descriptorContractVersion;
  final String descriptorVersion;
  final String sourceModelId;
  final String sourceModelVersion;
  final String sourceModelContractVersion;
  final String sourceModelSha256;
  final String generatorVersion;
  final List<ClassDescriptor> classes;
  final List<AssociationDescriptor> associations;

  const DescriptorRoot({
    required this.descriptorContractVersion,
    required this.descriptorVersion,
    required this.sourceModelId,
    required this.sourceModelVersion,
    required this.sourceModelContractVersion,
    required this.sourceModelSha256,
    required this.generatorVersion,
    required this.classes,
    required this.associations,
  });

  factory DescriptorRoot.fromJson(Map<String, dynamic> json) {
    void requireField(String field) {
      if (!json.containsKey(field) || json[field] == null) {
        throw DescriptorContractException(
          code: 'DESCRIPTOR_MISSING_REQUIRED_FIELD',
          message: 'DescriptorRoot missing required field: "$field"',
        );
      }
    }

    requireField('descriptorContractVersion');
    requireField('descriptorVersion');
    requireField('sourceModelId');
    requireField('sourceModelVersion');
    requireField('sourceModelContractVersion');
    requireField('sourceModelSha256');
    requireField('generatorVersion');
    requireField('classes');
    requireField('associations');

    final contractVersion = json['descriptorContractVersion'] as String;
    if (contractVersion != supportedContractVersion) {
      throw DescriptorContractException(
        code: 'DESCRIPTOR_CONTRACT_VERSION_MISMATCH',
        message:
            'Unsupported descriptorContractVersion: "$contractVersion". Supported version is "$supportedContractVersion".',
      );
    }

    final rawClasses = json['classes'] as List<dynamic>;
    final classes = rawClasses
        .map((c) => ClassDescriptor.fromJson(c as Map<String, dynamic>))
        .toList();

    final rawAssocs = json['associations'] as List<dynamic>;
    final associations = rawAssocs
        .map((a) => AssociationDescriptor.fromJson(a as Map<String, dynamic>))
        .toList();

    return DescriptorRoot(
      descriptorContractVersion: contractVersion,
      descriptorVersion: json['descriptorVersion'] as String,
      sourceModelId: json['sourceModelId'] as String,
      sourceModelVersion: json['sourceModelVersion'] as String,
      sourceModelContractVersion: json['sourceModelContractVersion'] as String,
      sourceModelSha256: json['sourceModelSha256'] as String,
      generatorVersion: json['generatorVersion'] as String,
      classes: classes,
      associations: associations,
    );
  }

  factory DescriptorRoot.fromString(String jsonString) {
    final dynamic decoded;
    try {
      decoded = jsonDecode(jsonString);
    } catch (e) {
      throw DescriptorContractException(
        code: 'DESCRIPTOR_MISSING_REQUIRED_FIELD',
        message: 'Invalid JSON format: $e',
      );
    }
    if (decoded is! Map<String, dynamic>) {
      throw const DescriptorContractException(
        code: 'DESCRIPTOR_MISSING_REQUIRED_FIELD',
        message: 'Root JSON element must be an object',
      );
    }
    return DescriptorRoot.fromJson(decoded);
  }

  Map<String, dynamic> toJson() => {
        'descriptorContractVersion': descriptorContractVersion,
        'descriptorVersion': descriptorVersion,
        'sourceModelId': sourceModelId,
        'sourceModelVersion': sourceModelVersion,
        'sourceModelContractVersion': sourceModelContractVersion,
        'sourceModelSha256': sourceModelSha256,
        'generatorVersion': generatorVersion,
        'classes': classes.map((c) => c.toJson()).toList(),
        'associations': associations.map((a) => a.toJson()).toList(),
      };
}
