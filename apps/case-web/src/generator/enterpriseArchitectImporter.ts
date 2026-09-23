import { importXmi } from 'xmi-adapter';
import type { CanonicalDomainModel } from '../domain/model';

export interface EaImportDiagnostic {
  code: string;
  severity: 'ERROR' | 'WARNING' | 'INFO';
  message: string;
}

export interface EaImportParseResult {
  outcome: 'success' | 'error';
  model: CanonicalDomainModel | null;
  diagnostics: EaImportDiagnostic[];
}

/** Comando listo para despachar por la sesión (type + payload del contrato model-commands-v1). */
export interface EaImportCommand {
  type: string;
  payload: Record<string, unknown>;
}

export interface EaImportPlan {
  commands: EaImportCommand[];
  diagnostics: EaImportDiagnostic[];
  /** true si hay ERROR y el plan no debe aplicarse. */
  blocked: boolean;
}

/**
 * Parsea un XMI 2.1 exportado por Enterprise Architect 15.x/16.x a modelo
 * canónico (perfil xmi-profile-v1). Determinista: sin IA ni efectos laterales.
 */
export function importEnterpriseArchitectXmi(xmiText: string): EaImportParseResult {
  const result = importXmi(xmiText);
  return {
    outcome: result.outcome,
    model: result.canonicalModel
      ? (result.canonicalModel as unknown as CanonicalDomainModel)
      : null,
    diagnostics: result.diagnostics.map((d) => ({
      code: d.code,
      severity: d.severity,
      message: d.message,
    })),
  };
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * El modelo canónico exige identificadores [A-Za-z_][A-Za-z0-9_]*; EA permite
 * nombres con espacios/acentos. Normaliza de forma determinista.
 */
export function sanitizeIdentifier(raw: string): string {
  const stripped = raw.normalize('NFD').replace(/\p{M}/gu, '');
  let s = stripped.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  if (!s) s = 'Elemento';
  if (!/^[A-Za-z_]/.test(s)) s = `_${s}`;
  return s;
}

/**
 * Traduce un modelo importado de EA a la secuencia de comandos que lo
 * materializa sobre la sesión vigente:
 *
 * - Los paquetes de EA NO se importan: las clases se materializan planas en la
 *   raíz del diagrama (diagnóstico PACKAGES_FLATTENED cuando el XMI los trae).
 * - Los ids se remapean a ids frescos (`cls-/attr-/assoc-`+uuid) para que
 *   importar sobre un diagrama no vacío nunca colisione por id.
 * - Los nombres se sanitizan a identificadores válidos (NAME_SANITIZED, aviso).
 * - Colisiones de nombre con el modelo existente o dentro del lote se reportan
 *   como IMPORT_NAME_COLLISION (bloqueante). Todas las clases compiten en el
 *   ámbito raíz, así que dos clases homónimas en paquetes EA distintos chocan.
 * - Orden: clases, atributos, relaciones — la sesión los aplica en orden FIFO
 *   con la versión vigente de cada envío.
 */
export function buildEaImportCommands(
  imported: CanonicalDomainModel,
  existing: CanonicalDomainModel | null
): EaImportPlan {
  const diagnostics: EaImportDiagnostic[] = [];
  const commands: EaImportCommand[] = [];

  const idMap = new Map<string, string>();
  const freshId = (prefix: string, original: string) => {
    const next = `${prefix}-${crypto.randomUUID()}`;
    idMap.set(original, next);
    return next;
  };

  const sanitize = (raw: string, what: string): string => {
    if (IDENTIFIER.test(raw)) return raw;
    const clean = sanitizeIdentifier(raw);
    diagnostics.push({
      code: 'NAME_SANITIZED',
      severity: 'WARNING',
      message: `${what} '${raw}' no es un identificador válido; se importa como '${clean}'.`,
    });
    return clean;
  };

  // Las clases se importan planas en el paquete raíz (el adaptador ya emite
  // PACKAGE_FLATTENED por cada uml:Package que atraviesa).
  const classNames = new Map<string, string>();
  for (const cls of imported.classes) {
    const id = freshId('cls', cls.id);
    const name = sanitize(cls.name, 'Clase');
    classNames.set(id, name);
    commands.push({
      type: 'CreateClass',
      payload: { id, name, description: cls.description },
    });
  }

  // Colisiones de nombre: todas las clases compiten en el único ámbito raíz.
  const existingRootClassNames = new Set(
    (existing?.classes ?? []).map((c) => c.name)
  );
  const seenClassNames = new Set<string>();
  for (const cls of imported.classes) {
    const name = classNames.get(idMap.get(cls.id)!)!;
    if (existingRootClassNames.has(name)) {
      diagnostics.push({
        code: 'IMPORT_NAME_COLLISION',
        severity: 'ERROR',
        message: `La clase '${name}' ya existe en el diagrama actual.`,
      });
    }
    if (seenClassNames.has(name)) {
      diagnostics.push({
        code: 'IMPORT_NAME_COLLISION',
        severity: 'ERROR',
        message: `Dos clases importadas se llaman '${name}'.`,
      });
    }
    seenClassNames.add(name);
  }

  for (const cls of imported.classes) {
    const classId = idMap.get(cls.id)!;
    const seenAttrs = new Set<string>();
    for (const attr of cls.attributes) {
      const name = sanitize(attr.name, `Atributo de '${cls.name}'`);
      if (seenAttrs.has(name)) {
        diagnostics.push({
          code: 'IMPORT_NAME_COLLISION',
          severity: 'ERROR',
          message: `La clase '${cls.name}' importa dos atributos llamados '${name}'.`,
        });
        continue;
      }
      seenAttrs.add(name);
      commands.push({
        type: 'AddAttribute',
        payload: {
          id: `attr-${crypto.randomUUID()}`,
          classId,
          name,
          type: attr.type,
          nullable: attr.nullable,
          multiplicity: attr.multiplicity,
          description: attr.description,
        },
      });
    }
  }

  for (const assoc of imported.associations) {
    const sourceClassId = idMap.get(assoc.sourceClassId);
    const targetClassId = idMap.get(assoc.targetClassId);
    const associationClassId = assoc.associationClassId
      ? idMap.get(assoc.associationClassId)
      : undefined;
    if (!sourceClassId || !targetClassId || (assoc.associationClassId && !associationClassId)) {
      diagnostics.push({
        code: 'IMPORT_UNRESOLVED_REF',
        severity: 'ERROR',
        message: `La relación '${assoc.name || assoc.id}' referencia clases ausentes del lote importado.`,
      });
      continue;
    }
    commands.push({
      type: 'CreateAssociation',
      payload: {
        id: `assoc-${crypto.randomUUID()}`,
        name: assoc.name || undefined,
        sourceClassId,
        targetClassId,
        sourceMultiplicity: assoc.sourceMultiplicity,
        targetMultiplicity: assoc.targetMultiplicity,
        navigability: assoc.navigability,
        kind: assoc.kind ?? 'association',
        associationClassId,
        description: assoc.description,
      },
    });
  }

  return {
    commands,
    diagnostics,
    blocked: diagnostics.some((d) => d.severity === 'ERROR'),
  };
}
