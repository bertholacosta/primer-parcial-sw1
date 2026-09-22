export interface CanonicalAttribute {
  id: string;
  name: string;
  type: string;
  nullable: boolean;
  multiplicity: string;
  description?: string;
}

export interface CanonicalClass {
  id: string;
  name: string;
  packageId?: string;
  description?: string;
  attributes: CanonicalAttribute[];
}

export type AssociationKind =
  | 'association'
  | 'aggregation'
  | 'composition'
  | 'generalization'
  | 'dependency'
  | 'associationClass';

export interface CanonicalAssociation {
  id: string;
  name?: string;
  sourceClassId: string;
  targetClassId: string;
  sourceMultiplicity: string;
  targetMultiplicity: string;
  navigability: 'unidirectional' | 'bidirectional';
  kind?: AssociationKind;
  associationClassId?: string;
  description?: string;
}

export interface CanonicalPackage {
  id: string;
  name: string;
  parentId?: string;
  description?: string;
}

export interface CanonicalDomainModel {
  contractVersion: string;
  id: string;
  name: string;
  version: string;
  description?: string;
  packages: CanonicalPackage[];
  classes: CanonicalClass[];
  associations: CanonicalAssociation[];
}

export class DomainModelContractError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'DomainModelContractError';
  }
}
