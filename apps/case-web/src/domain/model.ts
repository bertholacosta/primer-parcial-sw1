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

/**
 * El modelo ES el paquete raíz: no existen paquetes anidados ni el campo
 * `packages` (decisión PO: todas las clases viven en el ámbito raíz).
 */
export interface CanonicalDomainModel {
  contractVersion: string;
  id: string;
  name: string;
  version: string;
  description?: string;
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
