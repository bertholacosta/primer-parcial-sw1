#!/usr/bin/env node
/**
 * Validador del descriptor Flutter contra el contrato `flutter-descriptor` v1
 * (docs/contracts/flutter-descriptor-v1.md) y su trazabilidad al
 * `domain-model.json` origen.
 *
 * Uso:
 *   node scripts/validate-flutter-descriptor.mjs <flutter-descriptor.json> <domain-model.json>
 *
 * Salida: diagnósticos `ERROR <codigo> <ruta> - <mensaje>` (estilo del CLI de
 * domain-validator). Código de salida 0 si no hay errores, 1 si los hay, 2 en
 * errores de uso o lectura.
 *
 * Códigos de diagnóstico: los del contrato §8.2
 * (DESCRIPTOR_CONTRACT_VERSION_MISMATCH, DESCRIPTOR_MODEL_MISMATCH,
 * DESCRIPTOR_MISSING_REQUIRED_FIELD) más extensiones locales del circuito e2e:
 * DESCRIPTOR_INVALID_FIELD (tipo o valor fuera de dominio),
 * DESCRIPTOR_NON_CANONICAL_ORDER (orden distinto al canónico §6) y
 * DESCRIPTOR_INCOMPLETE_PROJECTION (elemento del modelo ausente del descriptor).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

// Reutiliza la toolchain construida por la etapa de arranque del e2e:
// `canonicalize` (§4 de domain-model v1) y la serialización canónica +
// sha256 del generador (misma implementación que produce `modelSha256`).
const { canonicalize } = await import(
  url.pathToFileURL(path.join(__dirname, "../packages/domain-model/dist/index.js")).href
);
const { canonicalJson, sha256Hex } = await import(
  url.pathToFileURL(path.join(__dirname, "../services/generator-cli/dist/model-io.js")).href
);

const ATTRIBUTE_TYPES = ["String", "Integer", "Long", "Double", "Boolean", "Date", "DateTime", "UUID"];
const MULTIPLICITIES = ["1", "0..1", "1..*", "0..*"];
const NAVIGABILITIES = ["unidirectional", "bidirectional"];
const SINGLE = new Set(["1", "0..1"]);

/** Mapeo determinista §4 del contrato del descriptor. */
function expectedUiType(type, multiplicity) {
  switch (type) {
    case "String": return SINGLE.has(multiplicity) ? "textField" : "textList";
    case "Integer":
    case "Long": return "integerField";
    case "Double": return "decimalField";
    case "Boolean": return "checkbox";
    case "Date": return "datePicker";
    case "DateTime": return "dateTimePicker";
    case "UUID": return "uuidField";
    default: return undefined;
  }
}

/** Inferencia determinista §5.1 del contrato del descriptor. */
function expectedRelationType(sourceMultiplicity, targetMultiplicity) {
  const s = SINGLE.has(sourceMultiplicity);
  const t = SINGLE.has(targetMultiplicity);
  if (s && t) return "oneToOne";
  if (!s && t) return "manyToOne";
  if (s && !t) return "oneToMany";
  return "manyToMany";
}

const errors = [];
function error(code, jsonPath, message) {
  errors.push({ code, path: jsonPath, message });
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireField(obj, field, jsonPath, type) {
  const value = obj[field];
  if (value === undefined) {
    error("DESCRIPTOR_MISSING_REQUIRED_FIELD", `${jsonPath}.${field}`, "Campo obligatorio ausente.");
    return undefined;
  }
  if (type === "array" ? !Array.isArray(value) : typeof value !== type) {
    error("DESCRIPTOR_INVALID_FIELD", `${jsonPath}.${field}`, `Tipo esperado '${type}'.`);
    return undefined;
  }
  return value;
}

function expectEqual(actual, expected, code, jsonPath, what) {
  if (actual !== expected) {
    error(code, jsonPath, `${what}: esperado '${expected}', encontrado '${actual}'.`);
  }
}

function isSortedBy(values, keyOf) {
  for (let i = 1; i < values.length; i++) {
    if (keyOf(values[i - 1]) > keyOf(values[i])) return false;
  }
  return true;
}

/** Orden canónico §6: sourceClassId ASC, luego id ASC (comparación pairwise). */
function isSortedAssociations(values) {
  const key = (a) => [String(a.sourceClassId ?? ""), String(a.id ?? "")];
  for (let i = 1; i < values.length; i++) {
    const [ps, pi] = key(values[i - 1]);
    const [cs, ci] = key(values[i]);
    if (ps > cs || (ps === cs && pi > ci)) return false;
  }
  return true;
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    console.error(`No se pudo leer o parsear '${file}': ${err.message}`);
    process.exit(2);
  }
}

function main(argv) {
  const [descriptorPath, modelPath] = argv;
  if (!descriptorPath || !modelPath) {
    console.error("Uso: validate-flutter-descriptor <flutter-descriptor.json> <domain-model.json>");
    return 2;
  }

  const descriptor = readJson(descriptorPath);
  const model = readJson(modelPath);
  if (!isRecord(descriptor) || !isRecord(model)) {
    console.error("El descriptor y el modelo deben ser documentos JSON objeto.");
    return 2;
  }

  // §2.1/§2.2: identidad del contrato y trazabilidad de origen.
  const contractVersion = requireField(descriptor, "descriptorContractVersion", "$", "string");
  if (contractVersion !== undefined && contractVersion !== "1") {
    error("DESCRIPTOR_CONTRACT_VERSION_MISMATCH", "$.descriptorContractVersion",
      `Versión '${contractVersion}' no soportada; se espera '1'.`);
  }
  const descriptorVersion = requireField(descriptor, "descriptorVersion", "$", "string");
  if (descriptorVersion !== undefined && !/^\d+\.\d+\.\d+$/.test(descriptorVersion)) {
    error("DESCRIPTOR_INVALID_FIELD", "$.descriptorVersion", "Formato MAJOR.MINOR.PATCH requerido.");
  }
  expectEqual(requireField(descriptor, "sourceModelId", "$", "string"), model.id,
    "DESCRIPTOR_MODEL_MISMATCH", "$.sourceModelId", "Trazabilidad del modelo");
  expectEqual(requireField(descriptor, "sourceModelVersion", "$", "string"), model.version,
    "DESCRIPTOR_MODEL_MISMATCH", "$.sourceModelVersion", "Trazabilidad del modelo");
  expectEqual(requireField(descriptor, "sourceModelContractVersion", "$", "string"), model.contractVersion,
    "DESCRIPTOR_MODEL_MISMATCH", "$.sourceModelContractVersion", "Trazabilidad del modelo");
  const expectedSha = sha256Hex(canonicalJson(canonicalize(model)));
  expectEqual(requireField(descriptor, "sourceModelSha256", "$", "string"), expectedSha,
    "DESCRIPTOR_MODEL_MISMATCH", "$.sourceModelSha256", "SHA-256 del modelo normalizado");
  const generatorVersion = requireField(descriptor, "generatorVersion", "$", "string");
  if (generatorVersion !== undefined && generatorVersion.length === 0) {
    error("DESCRIPTOR_INVALID_FIELD", "$.generatorVersion", "No puede ser vacío.");
  }

  const classes = requireField(descriptor, "classes", "$", "array") ?? [];
  const associations = requireField(descriptor, "associations", "$", "array") ?? [];

  const modelClasses = new Map((model.classes ?? []).map((c) => [c.id, c]));
  const modelPackages = new Map((model.packages ?? []).map((p) => [p.id, p]));
  const modelAssociations = new Map((model.associations ?? []).map((a) => [a.id, a]));
  const descriptorClassIds = new Set();

  // §6: orden canónico del descriptor.
  if (!isSortedBy(classes, (c) => (isRecord(c) ? String(c.id) : ""))) {
    error("DESCRIPTOR_NON_CANONICAL_ORDER", "$.classes", "El array no está ordenado por id ASC.");
  }

  classes.forEach((cls, i) => {
    const p = `$.classes[${i}]`;
    if (!isRecord(cls)) {
      error("DESCRIPTOR_INVALID_FIELD", p, "ClassDescriptor debe ser un objeto.");
      return;
    }
    const id = requireField(cls, "id", p, "string");
    requireField(cls, "name", p, "string");
    requireField(cls, "isAbstract", p, "boolean");
    const attrs = requireField(cls, "attributes", p, "array") ?? [];

    const modelClass = id === undefined ? undefined : modelClasses.get(id);
    if (id !== undefined) {
      descriptorClassIds.add(id);
      if (modelClass === undefined) {
        error("DESCRIPTOR_INVALID_FIELD", `${p}.id`, `El id '${id}' no existe en el modelo origen (I7).`);
      }
    }

    if (modelClass !== undefined) {
      expectEqual(cls.isAbstract, modelClass.isAbstract === true,
        "DESCRIPTOR_INVALID_FIELD", `${p}.isAbstract`, "Debe reflejar el modelo");
      const expectedPackage = modelClass.packageId === undefined
        ? null
        : (modelPackages.get(modelClass.packageId)?.name ?? null);
      const packageName = cls.packageName === undefined ? null : cls.packageName;
      expectEqual(packageName, expectedPackage,
        "DESCRIPTOR_INVALID_FIELD", `${p}.packageName`, "Nombre del paquete inmediato");
    }

    if (!isSortedBy(attrs, (a) => (isRecord(a) ? String(a.id) : ""))) {
      error("DESCRIPTOR_NON_CANONICAL_ORDER", `${p}.attributes`, "El array no está ordenado por id ASC.");
    }

    const modelAttrs = new Map((modelClass?.attributes ?? []).map((a) => [a.id, a]));
    attrs.forEach((attr, j) => {
      const ap = `${p}.attributes[${j}]`;
      if (!isRecord(attr)) {
        error("DESCRIPTOR_INVALID_FIELD", ap, "AttributeDescriptor debe ser un objeto.");
        return;
      }
      const attrId = requireField(attr, "id", ap, "string");
      requireField(attr, "name", ap, "string");
      const type = requireField(attr, "type", ap, "string");
      const nullable = requireField(attr, "nullable", ap, "boolean");
      const multiplicity = requireField(attr, "multiplicity", ap, "string");
      const uiType = requireField(attr, "uiType", ap, "string");
      const required = requireField(attr, "required", ap, "boolean");

      if (type !== undefined && !ATTRIBUTE_TYPES.includes(type)) {
        error("DESCRIPTOR_INVALID_FIELD", `${ap}.type`, `Tipo '${type}' fuera de domain-model v1.`);
      }
      if (multiplicity !== undefined && !MULTIPLICITIES.includes(multiplicity)) {
        error("DESCRIPTOR_INVALID_FIELD", `${ap}.multiplicity`, `Multiplicidad '${multiplicity}' inválida.`);
      }
      // I4: uiType completamente determinado por type + multiplicity.
      if (type !== undefined && multiplicity !== undefined && ATTRIBUTE_TYPES.includes(type)) {
        expectEqual(uiType, expectedUiType(type, multiplicity),
          "DESCRIPTOR_INVALID_FIELD", `${ap}.uiType`, "uiType determinista §4");
      }
      // §3.3: required = nullable:false y multiplicity:"1".
      if (nullable !== undefined && multiplicity !== undefined) {
        expectEqual(required, nullable === false && multiplicity === "1",
          "DESCRIPTOR_INVALID_FIELD", `${ap}.required`, "required derivado §3.3");
      }
      if (attrId !== undefined && modelClass !== undefined && !modelAttrs.has(attrId)) {
        error("DESCRIPTOR_INVALID_FIELD", `${ap}.id`, `El id '${attrId}' no existe en la clase '${id}' del modelo (I7).`);
      }
    });
  });

  // Cobertura de la proyección: cada clase del modelo aparece exactamente una vez.
  for (const classId of modelClasses.keys()) {
    if (!descriptorClassIds.has(classId)) {
      error("DESCRIPTOR_INCOMPLETE_PROJECTION", "$.classes", `La clase '${classId}' del modelo no tiene descriptor.`);
    }
  }

  if (!isSortedAssociations(associations.filter(isRecord))) {
    error("DESCRIPTOR_NON_CANONICAL_ORDER", "$.associations",
      "El array no está ordenado por sourceClassId ASC, luego id ASC.");
  }

  associations.forEach((assoc, i) => {
    const p = `$.associations[${i}]`;
    if (!isRecord(assoc)) {
      error("DESCRIPTOR_INVALID_FIELD", p, "AssociationDescriptor debe ser un objeto.");
      return;
    }
    const id = requireField(assoc, "id", p, "string");
    const sourceClassId = requireField(assoc, "sourceClassId", p, "string");
    const targetClassId = requireField(assoc, "targetClassId", p, "string");
    const sourceMultiplicity = requireField(assoc, "sourceMultiplicity", p, "string");
    const targetMultiplicity = requireField(assoc, "targetMultiplicity", p, "string");
    const navigability = requireField(assoc, "navigability", p, "string");
    const relationType = requireField(assoc, "relationType", p, "string");
    const lazy = requireField(assoc, "isLazyLoadable", p, "boolean");

    if (id !== undefined && !modelAssociations.has(id)) {
      error("DESCRIPTOR_INVALID_FIELD", `${p}.id`, `El id '${id}' no existe en el modelo origen (I7).`);
    }
    for (const [field, value] of [["sourceClassId", sourceClassId], ["targetClassId", targetClassId]]) {
      if (value !== undefined && !descriptorClassIds.has(value)) {
        error("DESCRIPTOR_INVALID_FIELD", `${p}.${field}`, `Referencia a clase inexistente '${value}'.`);
      }
    }
    for (const [field, value] of [["sourceMultiplicity", sourceMultiplicity], ["targetMultiplicity", targetMultiplicity]]) {
      if (value !== undefined && !MULTIPLICITIES.includes(value)) {
        error("DESCRIPTOR_INVALID_FIELD", `${p}.${field}`, `Multiplicidad '${value}' inválida.`);
      }
    }
    if (navigability !== undefined && !NAVIGABILITIES.includes(navigability)) {
      error("DESCRIPTOR_INVALID_FIELD", `${p}.navigability`, `Navegabilidad '${navigability}' inválida.`);
    }
    // I5: relationType determinista; §5.2: isLazyLoadable.
    if (MULTIPLICITIES.includes(sourceMultiplicity) && MULTIPLICITIES.includes(targetMultiplicity)) {
      const expected = expectedRelationType(sourceMultiplicity, targetMultiplicity);
      expectEqual(relationType, expected, "DESCRIPTOR_INVALID_FIELD", `${p}.relationType`, "relationType determinista §5.1");
      expectEqual(lazy, expected === "oneToMany" || expected === "manyToMany",
        "DESCRIPTOR_INVALID_FIELD", `${p}.isLazyLoadable`, "isLazyLoadable derivado §5.2");
    }
  });

  for (const e of errors) {
    console.log(`ERROR ${e.code} ${e.path} - ${e.message}`);
  }
  if (errors.length === 0) {
    console.log("OK: el descriptor satisface el contrato flutter-descriptor v1.");
    return 0;
  }
  return 1;
}

process.exit(main(process.argv.slice(2)));
