import _Ajv from "ajv";
const Ajv = _Ajv.default || _Ajv;
import type { ErrorObject, ValidateFunction } from "ajv";
import {
  DiagnosticCode,
  type Diagnostic,
  type ValidationResult,
} from "./diagnostics.js";
import { domainModelV1Schema } from "./schema-loader.js";

const ajv = new Ajv({ allErrors: true, strict: false });
const schemaValidate: ValidateFunction = ajv.compile(domainModelV1Schema);

const KNOWN_TOP_LEVEL_FIELDS = new Set([
  "contractVersion",
  "id",
  "name",
  "version",
  "description",
  "classes",
  "associations",
]);

const MULTIPLICITY_FIELDS = new Set([
  "multiplicity",
  "sourceMultiplicity",
  "targetMultiplicity",
]);

const IDENTIFIER_RX = /^[A-Za-z_][A-Za-z0-9_]*$/;

/* ------------------------------------------------------------------ */
/* JSONPath helpers                                                    */
/* ------------------------------------------------------------------ */

function pointerSegmentToJsonPath(segment: string): string {
  const unescaped = segment.replace(/~1/g, "/").replace(/~0/g, "~");
  if (/^\d+$/.test(unescaped)) return `[${unescaped}]`;
  if (IDENTIFIER_RX.test(unescaped)) return `.${unescaped}`;
  return `[${JSON.stringify(unescaped)}]`;
}

/** Convierte un instancePath de AJV (`/classes/0/name`) a JSONPath (`$.classes[0].name`). */
function toJsonPath(instancePath: string): string {
  if (!instancePath) return "$";
  return "$" + instancePath.split("/").slice(1).map(pointerSegmentToJsonPath).join("");
}

function childPath(parent: string, segment: string | number): string {
  return parent + pointerSegmentToJsonPath(String(segment));
}

function lastSegment(instancePath: string): string {
  const parts = instancePath.split("/");
  return parts[parts.length - 1] ?? "";
}

function getValueAtPointer(doc: unknown, instancePath: string): unknown {
  let current = doc;
  for (const raw of instancePath.split("/").slice(1)) {
    if (current === null || typeof current !== "object") return undefined;
    const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/* ------------------------------------------------------------------ */
/* Fase 1: validación estructural con AJV                              */
/* ------------------------------------------------------------------ */

function mapSchemaError(err: ErrorObject, doc: unknown): Diagnostic {
  const params = err.params as Record<string, unknown>;

  if (err.keyword === "required") {
    const missing = String(params.missingProperty);
    return {
      code: DiagnosticCode.MISSING_REQUIRED_FIELD,
      path: childPath(toJsonPath(err.instancePath), missing),
      message: `El campo '${missing}' es obligatorio.`,
      severity: "ERROR",
    };
  }

  const field = lastSegment(err.instancePath);
  const value = getValueAtPointer(doc, err.instancePath);
  const shown = typeof value === "string" ? value : JSON.stringify(value);

  switch (err.keyword) {
    case "const":
      if (field === "contractVersion") {
        return {
          code: DiagnosticCode.UNSUPPORTED_CONTRACT_VERSION,
          path: toJsonPath(err.instancePath),
          message: `La contractVersion '${shown}' no está soportada; este validador soporta '1'.`,
          severity: "ERROR",
        };
      }
      break;
    case "enum":
      if (field === "type") {
        return {
          code: DiagnosticCode.UNKNOWN_TYPE,
          path: toJsonPath(err.instancePath),
          message: `Tipo '${shown}' no reconocido en el corte mínimo v1.`,
          severity: "ERROR",
        };
      }
      if (MULTIPLICITY_FIELDS.has(field)) {
        return {
          code: DiagnosticCode.INVALID_MULTIPLICITY,
          path: toJsonPath(err.instancePath),
          message: `Multiplicidad '${shown}' no reconocida; use uno de: "1", "0..1", "1..*", "0..*".`,
          severity: "ERROR",
        };
      }
      if (field === "navigability") {
        return {
          code: DiagnosticCode.INVALID_NAVIGABILITY,
          path: toJsonPath(err.instancePath),
          message: `Navegabilidad '${shown}' no reconocida; use "unidirectional" o "bidirectional".`,
          severity: "ERROR",
        };
      }
      return {
        code: DiagnosticCode.INVALID_ENUM_VALUE,
        path: toJsonPath(err.instancePath),
        message: `Valor '${shown}' no permitido para el campo '${field}'.`,
        severity: "ERROR",
      };
    case "pattern":
      if (field === "version") {
        return {
          code: DiagnosticCode.INVALID_VERSION_FORMAT,
          path: toJsonPath(err.instancePath),
          message: `La versión '${shown}' no sigue el formato MAJOR.MINOR.PATCH.`,
          severity: "ERROR",
        };
      }
      return {
        code: DiagnosticCode.INVALID_IDENTIFIER,
        path: toJsonPath(err.instancePath),
        message: `El valor '${shown}' no es un identificador válido [A-Za-z_][A-Za-z0-9_]*.`,
        severity: "ERROR",
      };
    case "type":
      return {
        code: DiagnosticCode.INVALID_FIELD_TYPE,
        path: toJsonPath(err.instancePath) || "$",
        message: `El campo '${field || "$"}' debe ser de tipo '${String(params.type)}'.`,
        severity: "ERROR",
      };
    case "minLength":
      return {
        code: DiagnosticCode.INVALID_VALUE,
        path: toJsonPath(err.instancePath),
        message: `El campo '${field}' no puede estar vacío.`,
        severity: "ERROR",
      };
    default:
      return {
        code: DiagnosticCode.INVALID_VALUE,
        path: toJsonPath(err.instancePath) || "$",
        message: `Valor inválido (regla '${err.keyword}').`,
        severity: "ERROR",
      };
  }

  return {
    code: DiagnosticCode.INVALID_VALUE,
    path: toJsonPath(err.instancePath) || "$",
    message: `Valor inválido (regla '${err.keyword}').`,
    severity: "ERROR",
  };
}

/* ------------------------------------------------------------------ */
/* Fase 2: reglas semánticas del contrato                              */
/* ------------------------------------------------------------------ */

interface DocAttribute {
  id: string;
  name: string;
  type: string;
  nullable: boolean;
  multiplicity: string;
}

interface DocClass {
  id: string;
  name: string;
  attributes: DocAttribute[];
}

interface DocAssociation {
  id: string;
  sourceClassId: string;
  targetClassId: string;
  kind?: string;
  associationClassId?: string;
}

interface DocShape {
  classes: DocClass[];
  associations: DocAssociation[];
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Índices del array ordenados por la clave canónica dada. */
function canonicalOrder<T>(items: T[], key: (item: T) => (string | null)[]): number[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((x, y) => {
      const ka = key(x.item);
      const kb = key(y.item);
      for (let i = 0; i < ka.length; i++) {
        const a = ka[i];
        const b = kb[i];
        if (a === null && b !== null) return -1;
        if (a !== null && b === null) return 1;
        if (a !== null && b !== null) {
          const c = compareStrings(a, b);
          if (c !== 0) return c;
        }
      }
      return x.index - y.index;
    })
    .map((entry) => entry.index);
}

function isCanonicalOrder<T>(items: T[], key: (item: T) => (string | null)[]): boolean {
  const order = canonicalOrder(items, key);
  return order.every((value, i) => value === i);
}

const classKey = (c: DocClass): (string | null)[] => [c.id];
const attributeKey = (a: DocAttribute): (string | null)[] => [a.id];
const associationKey = (a: DocAssociation): (string | null)[] => [a.sourceClassId, a.id];

function semanticValidation(doc: Record<string, unknown>, errors: Diagnostic[], warnings: Diagnostic[]): void {
  const model = doc as unknown as DocShape;

  // §2.3 — campos desconocidos de nivel superior: advertencia no bloqueante.
  for (const field of Object.keys(doc).sort()) {
    if (!KNOWN_TOP_LEVEL_FIELDS.has(field)) {
      warnings.push({
        code: DiagnosticCode.UNKNOWN_FIELD,
        path: childPath("$", field),
        message: `Campo de nivel superior '${field}' no declarado en el contrato v1; se ignora y se preserva.`,
        severity: "WARNING",
      });
    }
  }

  // Unicidad global de id (§3.2–§3.7: "único en el documento").
  const seenIds = new Map<string, string>();
  const registerId = (id: string, path: string) => {
    const first = seenIds.get(id);
    if (first === undefined) {
      seenIds.set(id, path);
    } else {
      errors.push({
        code: DiagnosticCode.DUPLICATE_ID,
        path,
        message: `El id '${id}' está duplicado en el documento (primera aparición en ${first}).`,
        severity: "ERROR",
      });
    }
  };

  const classIds = new Set(model.classes.map((c) => c.id));

  // --- Classes ---
  const classNameSeen = new Map<string, { path: string }>();
  for (const i of canonicalOrder(model.classes, classKey)) {
    const cls = model.classes[i];
    const base = `$.classes[${i}]`;
    registerId(cls.id, childPath(base, "id"));

    const namePath = childPath(base, "name");
    if (classNameSeen.has(cls.name)) {
      errors.push({
        code: DiagnosticCode.DUPLICATE_NAME,
        path: namePath,
        message: `Nombre '${cls.name}' duplicado en el espacio de nombres raíz.`,
        severity: "ERROR",
      });
    } else {
      classNameSeen.set(cls.name, { path: namePath });
    }

    // --- Attributes ---
    const attrNameSeen = new Set<string>();
    for (const j of canonicalOrder(cls.attributes, attributeKey)) {
      const attr = cls.attributes[j];
      const attrBase = `${base}.attributes[${j}]`;
      registerId(attr.id, childPath(attrBase, "id"));

      const attrNamePath = childPath(attrBase, "name");
      if (attrNameSeen.has(attr.name)) {
        errors.push({
          code: DiagnosticCode.DUPLICATE_NAME,
          path: attrNamePath,
          message: `Nombre '${attr.name}' duplicado en la clase '${cls.id}'.`,
          severity: "ERROR",
        });
      } else {
        attrNameSeen.add(attr.name);
      }

      // §3.6 — coherencia nullable/multiplicity (advertencias).
      if (attr.multiplicity === "1" && attr.nullable === true) {
        warnings.push({
          code: DiagnosticCode.NULLABLE_REQUIRED_CONFLICT,
          path: attrBase,
          message: "El atributo tiene multiplicity '1' pero nullable es true.",
          severity: "WARNING",
        });
      }
      if (attr.multiplicity === "0..1" && attr.nullable === false) {
        warnings.push({
          code: DiagnosticCode.NOT_NULLABLE_OPTIONAL_CONFLICT,
          path: attrBase,
          message: "El atributo tiene multiplicity '0..1' pero nullable es false.",
          severity: "WARNING",
        });
      }
    }

    if (!isCanonicalOrder(cls.attributes, attributeKey)) {
      warnings.push({
        code: DiagnosticCode.OUT_OF_CANONICAL_ORDER,
        path: `${base}.attributes`,
        message: `El array 'attributes' de la clase '${cls.id}' no sigue el orden canónico (id ASC).`,
        severity: "WARNING",
      });
    }
  }

  // --- Associations ---
  for (const i of canonicalOrder(model.associations, associationKey)) {
    const assoc = model.associations[i];
    const base = `$.associations[${i}]`;
    registerId(assoc.id, childPath(base, "id"));

    if (!classIds.has(assoc.sourceClassId)) {
      errors.push({
        code: DiagnosticCode.UNRESOLVED_REFERENCE,
        path: childPath(base, "sourceClassId"),
        message: `La clase '${assoc.sourceClassId}' no existe en el documento.`,
        severity: "ERROR",
      });
    }
    if (!classIds.has(assoc.targetClassId)) {
      errors.push({
        code: DiagnosticCode.UNRESOLVED_REFERENCE,
        path: childPath(base, "targetClassId"),
        message: `La clase '${assoc.targetClassId}' no existe en el documento.`,
        severity: "ERROR",
      });
    }
    if (assoc.sourceClassId === assoc.targetClassId) {
      errors.push({
        code: DiagnosticCode.SELF_ASSOCIATION,
        path: childPath(base, "targetClassId"),
        message: `La asociación '${assoc.id}' no puede tener la misma clase origen y destino.`,
        severity: "ERROR",
      });
    }
    const kind = assoc.kind ?? "association";
    if (kind === "associationClass") {
      if (!assoc.associationClassId) {
        errors.push({
          code: DiagnosticCode.MISSING_REQUIRED_FIELD,
          path: childPath(base, "associationClassId"),
          message: `La clase-asociación '${assoc.id}' requiere 'associationClassId'.`,
          severity: "ERROR",
        });
      } else if (!classIds.has(assoc.associationClassId)) {
        errors.push({
          code: DiagnosticCode.UNRESOLVED_REFERENCE,
          path: childPath(base, "associationClassId"),
          message: `La clase-asociación '${assoc.associationClassId}' no existe en el documento.`,
          severity: "ERROR",
        });
      }
    }
    if (kind === "composition" && model.associations.some((o) => o !== assoc && o.kind === "composition" && o.targetClassId === assoc.targetClassId)) {
      errors.push({
        code: DiagnosticCode.INVALID_VALUE,
        path: childPath(base, "targetClassId"),
        message: `La clase '${assoc.targetClassId}' es parte de más de una composición.`,
        severity: "ERROR",
      });
    }
    if (kind === "generalization" && model.associations.some((o) => o !== assoc && o.kind === "generalization" && o.sourceClassId === assoc.sourceClassId)) {
      errors.push({
        code: DiagnosticCode.INVALID_VALUE,
        path: childPath(base, "sourceClassId"),
        message: `La clase '${assoc.sourceClassId}' tiene más de una generalización (herencia múltiple no admitida).`,
        severity: "ERROR",
      });
    }
  }

  // Ciclos de herencia: seguir la cadena padre de cada generalización.
  const generalizationParent = new Map<string, string>();
  for (const assoc of model.associations) {
    if ((assoc.kind ?? "association") === "generalization") generalizationParent.set(assoc.sourceClassId, assoc.targetClassId);
  }
  for (const [childId] of generalizationParent) {
    const seen = new Set<string>([childId]);
    let current = generalizationParent.get(childId);
    while (current) {
      if (seen.has(current)) {
        errors.push({
          code: DiagnosticCode.INVALID_VALUE,
          path: "$.associations",
          message: `Ciclo de herencia detectado que involucra a la clase '${childId}'.`,
          severity: "ERROR",
        });
        break;
      }
      seen.add(current);
      current = generalizationParent.get(current);
    }
  }

  // §4 — orden canónico de los arrays de nivel superior.
  if (!isCanonicalOrder(model.classes, classKey)) {
    warnings.push({
      code: DiagnosticCode.OUT_OF_CANONICAL_ORDER,
      path: "$.classes",
      message: "El array 'classes' no sigue el orden canónico (id ASC).",
      severity: "WARNING",
    });
  }
  if (!isCanonicalOrder(model.associations, associationKey)) {
    warnings.push({
      code: DiagnosticCode.OUT_OF_CANONICAL_ORDER,
      path: "$.associations",
      message: "El array 'associations' no sigue el orden canónico (sourceClassId ASC, id ASC).",
      severity: "WARNING",
    });
  }
}

/* ------------------------------------------------------------------ */
/* API pública                                                         */
/* ------------------------------------------------------------------ */

/**
 * Valida un documento contra el contrato domain-model v1.
 * Fase 1: esquema estructural (AJV). Fase 2: reglas semánticas del contrato,
 * ejecutadas solo cuando la estructura es válida. Sin dependencia de red.
 */
export function validate(doc: unknown): ValidationResult {
  const errors: Diagnostic[] = [];
  const warnings: Diagnostic[] = [];

  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
    errors.push({
      code: DiagnosticCode.INVALID_FIELD_TYPE,
      path: "$",
      message: "El documento debe ser un objeto JSON.",
      severity: "ERROR",
    });
    return { valid: false, errors, warnings };
  }

  const schemaOk = schemaValidate(doc);
  if (!schemaOk) {
    for (const err of schemaValidate.errors ?? []) {
      errors.push(mapSchemaError(err, doc));
    }
    return { valid: false, errors, warnings };
  }

  semanticValidation(doc as Record<string, unknown>, errors, warnings);
  return { valid: errors.length === 0, errors, warnings };
}
