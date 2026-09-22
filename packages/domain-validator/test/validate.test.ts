import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { validate } from "../src/index.js";

function fixture(name: string): unknown {
  const url = new URL(`../../../fixtures/models/${name}`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8"));
}

describe("contrato domain-model v1 — ejemplos normativos §6", () => {
  it("acepta el ejemplo mínimo válido (§6.1)", () => {
    const result = validate(fixture("valid-minimal.json"));
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("rechaza documento sin contractVersion (§6.2.1)", () => {
    const result = validate(fixture("invalid-missing-contract-version.json"));
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      {
        code: "MISSING_REQUIRED_FIELD",
        path: "$.contractVersion",
        message: "El campo 'contractVersion' es obligatorio.",
        severity: "ERROR",
      },
    ]);
  });

  it("rechaza tipo de atributo desconocido (§6.2.2)", () => {
    const result = validate(fixture("invalid-unknown-type.json"));
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      {
        code: "UNKNOWN_TYPE",
        path: "$.classes[0].attributes[0].type",
        message: "Tipo 'BigDecimal' no reconocido en el corte mínimo v1.",
        severity: "ERROR",
      },
    ]);
  });

  it("rechaza asociación que referencia clase inexistente (§6.2.3)", () => {
    const result = validate(fixture("invalid-unresolved-reference.json"));
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      {
        code: "UNRESOLVED_REFERENCE",
        path: "$.associations[0].targetClassId",
        message: "La clase 'cls-no-existe' no existe en el documento.",
        severity: "ERROR",
      },
    ]);
  });

  it("rechaza nombres de clase duplicados en el mismo paquete (§6.2.4)", () => {
    const result = validate(fixture("invalid-duplicate-class-name.json"));
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      {
        code: "DUPLICATE_NAME",
        path: "$.classes[1].name",
        message: "Nombre 'Entidad' duplicado en el paquete 'pkg-a'.",
        severity: "ERROR",
      },
    ]);
  });

  it("emite advertencia no bloqueante por nullable/multiplicity '1' (§6.2.5)", () => {
    const result = validate(fixture("warning-nullable-required-conflict.json"));
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([
      {
        code: "NULLABLE_REQUIRED_CONFLICT",
        path: "$.classes[0].attributes[0]",
        message: "El atributo tiene multiplicity '1' pero nullable es true.",
        severity: "WARNING",
      },
    ]);
  });
});

describe("restricciones adicionales del contrato", () => {
  it("rechaza contractVersion distinta de '1'", () => {
    const result = validate(fixture("invalid-unsupported-contract-version.json"));
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatchObject({
      code: "UNSUPPORTED_CONTRACT_VERSION",
      path: "$.contractVersion",
      severity: "ERROR",
    });
  });

  it("rechaza la ausencia de los arrays obligatorios", () => {
    const result = validate(fixture("invalid-missing-arrays.json"));
    expect(result.valid).toBe(false);
    const paths = result.errors.map((e) => `${e.code}@${e.path}`);
    expect(paths).toContain("MISSING_REQUIRED_FIELD@$.packages");
    expect(paths).toContain("MISSING_REQUIRED_FIELD@$.classes");
    expect(paths).toContain("MISSING_REQUIRED_FIELD@$.associations");
  });

  it("rechaza un packageId de clase que no existe", () => {
    const result = validate(fixture("invalid-unresolved-package-reference.json"));
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatchObject({
      code: "UNRESOLVED_REFERENCE",
      path: "$.classes[0].packageId",
    });
  });

  it("rechaza ciclos en la jerarquía de paquetes", () => {
    const result = validate(fixture("invalid-package-cycle.json"));
    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain("PACKAGE_CYCLE");
  });

  it("rechaza auto-asociaciones", () => {
    const result = validate(fixture("invalid-self-association.json"));
    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain("SELF_ASSOCIATION");
  });

  it("rechaza ids duplicados en el documento", () => {
    const result = validate(fixture("invalid-duplicate-id.json"));
    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain("DUPLICATE_ID");
  });

  it("permite el mismo nombre de clase en paquetes distintos", () => {
    const result = validate(fixture("valid-duplicate-class-names-different-packages.json"));
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("advierte sobre multiplicity '0..1' con nullable false", () => {
    const result = validate(fixture("warning-not-nullable-optional-conflict.json"));
    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: "NOT_NULLABLE_OPTIONAL_CONFLICT",
        path: "$.classes[0].attributes[0]",
        severity: "WARNING",
      }),
    ]);
  });

  it("advierte sobre campos de nivel superior desconocidos sin bloquear", () => {
    const result = validate(fixture("warning-unknown-top-level-field.json"));
    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: "UNKNOWN_FIELD", path: "$.campoExtra" }),
    ]);
  });

  it("advierte cuando los arrays no siguen el orden canónico", () => {
    const result = validate(fixture("warning-out-of-canonical-order.json"));
    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: "OUT_OF_CANONICAL_ORDER",
        path: "$.classes",
      }),
    ]);
  });

  it("rechaza nombres que no son identificadores válidos", () => {
    const result = validate(fixture("invalid-invalid-identifier.json"));
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatchObject({
      code: "INVALID_IDENTIFIER",
      path: "$.classes[0].name",
    });
  });

  it("rechaza multiplicidad fuera del conjunto permitido", () => {
    const result = validate(fixture("invalid-invalid-multiplicity.json"));
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatchObject({
      code: "INVALID_MULTIPLICITY",
      path: "$.classes[0].attributes[0].multiplicity",
    });
  });
});

function doc(associations: unknown[]): unknown {
  return {
    contractVersion: "1",
    id: "m1",
    name: "Test",
    version: "1.0.0",
    packages: [],
    classes: [
      { id: "c-a", name: "Padre", attributes: [] },
      { id: "c-b", name: "Hija", attributes: [] },
      { id: "c-c", name: "Otra", attributes: [] },
    ],
    associations,
  };
}

describe("tipos de relación UML (ADR-0009)", () => {
  it("acepta generalization y dependency válidas", () => {
    const result = validate(doc([
      { id: "g1", kind: "generalization", sourceClassId: "c-b", targetClassId: "c-a", sourceMultiplicity: "1", targetMultiplicity: "1", navigability: "unidirectional" },
      { id: "d1", kind: "dependency", sourceClassId: "c-c", targetClassId: "c-a", sourceMultiplicity: "1", targetMultiplicity: "1", navigability: "unidirectional" },
    ]));
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("rechaza ciclo de herencia", () => {
    const result = validate(doc([
      { id: "g1", kind: "generalization", sourceClassId: "c-b", targetClassId: "c-a", sourceMultiplicity: "1", targetMultiplicity: "1", navigability: "unidirectional" },
      { id: "g2", kind: "generalization", sourceClassId: "c-a", targetClassId: "c-b", sourceMultiplicity: "1", targetMultiplicity: "1", navigability: "unidirectional" },
    ]));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes("Ciclo de herencia"))).toBe(true);
  });

  it("rechaza herencia múltiple", () => {
    const result = validate(doc([
      { id: "g1", kind: "generalization", sourceClassId: "c-b", targetClassId: "c-a", sourceMultiplicity: "1", targetMultiplicity: "1", navigability: "unidirectional" },
      { id: "g2", kind: "generalization", sourceClassId: "c-b", targetClassId: "c-c", sourceMultiplicity: "1", targetMultiplicity: "1", navigability: "unidirectional" },
    ]));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes("herencia múltiple"))).toBe(true);
  });

  it("rechaza parte en dos composiciones", () => {
    const result = validate(doc([
      { id: "c1", kind: "composition", sourceClassId: "c-a", targetClassId: "c-b", sourceMultiplicity: "1", targetMultiplicity: "0..*", navigability: "unidirectional" },
      { id: "c2", kind: "composition", sourceClassId: "c-c", targetClassId: "c-b", sourceMultiplicity: "1", targetMultiplicity: "1", navigability: "unidirectional" },
    ]));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes("más de una composición"))).toBe(true);
  });

  it("rechaza associationClass sin associationClassId o inexistente", () => {
    const missing = validate(doc([
      { id: "ac1", kind: "associationClass", sourceClassId: "c-a", targetClassId: "c-b", sourceMultiplicity: "1", targetMultiplicity: "1", navigability: "bidirectional" },
    ]));
    expect(missing.errors.some(e => e.code === "MISSING_REQUIRED_FIELD")).toBe(true);

    const unresolved = validate(doc([
      { id: "ac1", kind: "associationClass", sourceClassId: "c-a", targetClassId: "c-b", sourceMultiplicity: "1", targetMultiplicity: "1", navigability: "bidirectional", associationClassId: "c-x" },
    ]));
    expect(unresolved.errors.some(e => e.code === "UNRESOLVED_REFERENCE")).toBe(true);
  });
});
