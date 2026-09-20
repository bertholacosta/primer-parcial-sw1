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
  isAbstract?: boolean;
  description?: string;
  attributes: CanonicalAttribute[];
}

export interface CanonicalAssociation {
  id: string;
  name?: string;
  sourceClassId: string;
  targetClassId: string;
  sourceMultiplicity: string;
  targetMultiplicity: string;
  navigability: 'unidirectional' | 'bidirectional';
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
