import {
  exportXmi,
  CanonicalDomainModel as XmiDomainModel,
  CanonicalAttribute as XmiAttribute,
  CanonicalClass as XmiClass,
  CanonicalAssociation as XmiAssociation,
  CanonicalType,
  CanonicalMultiplicity,
  CanonicalAssociationKind
} from 'xmi-adapter';
import { CanonicalDomainModel } from '../domain/model';

/** Versión de Enterprise Architect objetivo declarada en el XMI (contrato xmi-profile-v1 §2). */
export const EA_TARGET_VERSION = '15.0.1514.12';

function toKebabCase(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

/**
 * Proyecta el modelo canónico del editor sobre los tipos del adaptador XMI.
 * El adaptador solo conoce el subconjunto del perfil xmi-profile-v1.
 */
function toXmiModel(model: CanonicalDomainModel): XmiDomainModel {
  const classes: XmiClass[] = model.classes.map(cls => ({
    id: cls.id,
    name: cls.name,
    description: cls.description,
    attributes: cls.attributes.map(
      (attr): XmiAttribute => ({
        id: attr.id,
        name: attr.name,
        type: attr.type as CanonicalType,
        nullable: attr.nullable,
        multiplicity: attr.multiplicity as CanonicalMultiplicity,
        description: attr.description
      })
    )
  }));

  const associations: XmiAssociation[] = model.associations.map(assoc => ({
    id: assoc.id,
    name: assoc.name,
    sourceClassId: assoc.sourceClassId,
    targetClassId: assoc.targetClassId,
    sourceMultiplicity: assoc.sourceMultiplicity as CanonicalMultiplicity,
    targetMultiplicity: assoc.targetMultiplicity as CanonicalMultiplicity,
    navigability: assoc.navigability,
    kind: assoc.kind as CanonicalAssociationKind | undefined,
    associationClassId: assoc.associationClassId,
    description: assoc.description
  }));

  return {
    contractVersion: '1',
    id: model.id,
    name: model.name,
    version: model.version,
    classes,
    associations
  };
}

/**
 * Construye el documento XMI 2.1 (perfil Enterprise Architect, §2 del contrato)
 * sin descargarlo. Separado de la descarga para permitir pruebas unitarias.
 */
export function buildEnterpriseArchitectXmi(model: CanonicalDomainModel): string {
  return exportXmi(toXmiModel(model), { eaVersion: EA_TARGET_VERSION });
}

/**
 * Genera el archivo .xmi importable por Enterprise Architect 15.0.1514.12
 * (Import Model from XMI) y lo descarga en el browser. No requiere servidor.
 */
export function generateAndDownloadEnterpriseArchitect(model: CanonicalDomainModel): void {
  const xmi = buildEnterpriseArchitectXmi(model);
  const blob = new Blob([xmi], { type: 'application/xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${toKebabCase(model.name) || 'modelo'}-ea15.xmi`;
  a.click();
  URL.revokeObjectURL(url);
}
