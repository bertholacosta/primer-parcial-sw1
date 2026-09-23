export type CanonicalMultiplicity = '1' | '0..1' | '1..*' | '0..*';
export type CanonicalNavigability = 'bidirectional' | 'unidirectional';
export type CanonicalAssociationKind =
  | 'association'
  | 'aggregation'
  | 'composition'
  | 'generalization'
  | 'dependency'
  | 'associationClass';
export type CanonicalType =
  | 'String'
  | 'Integer'
  | 'Long'
  | 'Double'
  | 'Boolean'
  | 'Date'
  | 'DateTime'
  | 'UUID';

export interface CanonicalAttribute {
  id: string;
  name: string;
  type: CanonicalType;
  nullable: boolean;
  multiplicity: CanonicalMultiplicity;
  description?: string;
}

export interface CanonicalClass {
  id: string;
  name: string;
  packageId?: string;
  description?: string;
  attributes: CanonicalAttribute[];
}

export interface CanonicalPackage {
  id: string;
  name: string;
  parentId?: string;
  description?: string;
}

export interface CanonicalAssociation {
  id: string;
  name?: string;
  sourceClassId: string;
  targetClassId: string;
  sourceMultiplicity: CanonicalMultiplicity;
  targetMultiplicity: CanonicalMultiplicity;
  navigability: CanonicalNavigability;
  kind?: CanonicalAssociationKind;
  associationClassId?: string;
  description?: string;
}

export interface CanonicalDomainModel {
  contractVersion: '1';
  id: string;
  name: string;
  version: string;
  packages: CanonicalPackage[];
  classes: CanonicalClass[];
  associations: CanonicalAssociation[];
}

export type DiagnosticSeverity = 'ERROR' | 'WARNING' | 'INFO';

export type DiagnosticCode =
  | 'UNSUPPORTED_EXPORTER'
  | 'MISSING_ROOT_MODEL'
  | 'DUPLICATE_ID'
  | 'UNKNOWN_TYPE'
  | 'UNSUPPORTED_MULTIPLICITY'
  | 'UNRESOLVED_CLASS_REF'
  | 'SELF_ASSOCIATION_NOT_SUPPORTED'
  | 'MALFORMED_XMI'
  | 'TYPE_PROMOTED'
  | 'OWNEDCOMMENT_HTML_DISCARDED'
  | 'ELEMENT_IGNORED'
  | 'OUT_OF_CANONICAL_ORDER'
  | 'NULLABLE_REQUIRED_CONFLICT'
  | 'NOT_NULLABLE_OPTIONAL_CONFLICT';

export interface XmiDiagnostic {
  code: DiagnosticCode;
  severity: DiagnosticSeverity;
  path: string;
  message: string;
  element?: Record<string, unknown>;
}

export interface ImportResult {
  outcome: 'success' | 'error';
  canonicalModel: CanonicalDomainModel | null;
  diagnostics: XmiDiagnostic[];
}

export interface ImportOptions {
  verbose?: boolean;
}
