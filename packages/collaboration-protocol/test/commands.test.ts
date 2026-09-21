import { describe, expect, it } from "vitest";
import { applyCommand } from "../src/commands.js";
import type { ModelCommand } from "../src/commands.js";
import { canonicalizeModel, modelSha256, stableStringify } from "../src/model.js";
import type { DomainModel } from "../src/model.js";

function baseModel(): DomainModel {
  return {
    contractVersion: "1",
    id: "model-01",
    name: "SistemaVentas",
    version: "1.0.0",
    packages: [{ id: "pkg-01", name: "ventas" }],
    classes: [
      { id: "cls-01", name: "Producto", packageId: "pkg-01", isAbstract: false, attributes: [] },
    ],
    associations: [],
  };
}

function cmd(command: Omit<ModelCommand, "modelId" | "modelVersion" | "commandId"> & { commandId?: string }): ModelCommand {
  return {
    commandId: command.commandId ?? `cmd-${command.type}`,
    modelId: "model-01",
    modelVersion: "1.0.0",
    ...command,
  } as ModelCommand;
}

describe("procesador de comandos model-commands-v1", () => {
  it("CreateClass aceptado muta el modelo e incrementa PATCH", () => {
    const outcome = applyCommand(
      baseModel(),
      cmd({ type: "CreateClass", payload: { id: "cls-02", name: "Categoria", packageId: "pkg-01" } }),
    );
    expect(outcome.result).toBe("accepted");
    expect(outcome.modelVersion).toBe("1.0.1");
    expect(outcome.model.classes.map((c) => c.id)).toContain("cls-02");
    const created = outcome.model.classes.find((c) => c.id === "cls-02")!;
    expect(created.isAbstract).toBe(false);
    expect(created.attributes).toEqual([]);
  });

  it("rechaza con CONCURRENT_MODIFICATION sin mutar el modelo", () => {
    const model = baseModel();
    const outcome = applyCommand(model, {
      ...cmd({ type: "CreateClass", payload: { id: "cls-02", name: "Categoria" } }),
      modelVersion: "9.9.9",
    });
    expect(outcome.result).toBe("rejected");
    expect(outcome.errors.some((e) => e.code === "CONCURRENT_MODIFICATION")).toBe(true);
    expect(outcome.model).toBe(model);
    expect(outcome.modelVersion).toBe("1.0.0");
  });

  it("rechaza con MODEL_NOT_FOUND de inmediato", () => {
    const outcome = applyCommand(baseModel(), {
      ...cmd({ type: "CreateClass", payload: { id: "cls-02", name: "Categoria" } }),
      modelId: "otro-modelo",
    });
    expect(outcome.result).toBe("rejected");
    expect(outcome.errors).toHaveLength(1);
    expect(outcome.errors[0].code).toBe("MODEL_NOT_FOUND");
  });

  it("acumula errores de precondición (DUPLICATE_CLASS_NAME)", () => {
    const outcome = applyCommand(
      baseModel(),
      cmd({ type: "CreateClass", payload: { id: "cls-02", name: "Producto", packageId: "pkg-01" } }),
    );
    expect(outcome.result).toBe("rejected");
    expect(outcome.errors.map((e) => e.code)).toContain("DUPLICATE_CLASS_NAME");
  });

  it("AddAttribute rechaza tipo desconocido con UNKNOWN_TYPE", () => {
    const outcome = applyCommand(
      baseModel(),
      cmd({
        type: "AddAttribute",
        payload: { id: "attr-01", classId: "cls-01", name: "precio", type: "BigDecimal", nullable: false, multiplicity: "1" },
      }),
    );
    expect(outcome.result).toBe("rejected");
    expect(outcome.errors.map((e) => e.code)).toContain("UNKNOWN_TYPE");
  });

  it("AddAttribute aceptado añade el atributo y emite advertencias no bloqueantes", () => {
    const outcome = applyCommand(
      baseModel(),
      cmd({
        type: "AddAttribute",
        payload: { id: "attr-01", classId: "cls-01", name: "precio", type: "Double", nullable: true, multiplicity: "1" },
      }),
    );
    expect(outcome.result).toBe("accepted");
    expect(outcome.warnings.map((w) => w.code)).toContain("NULLABLE_REQUIRED_CONFLICT");
    const cls = outcome.model.classes.find((c) => c.id === "cls-01")!;
    expect(cls.attributes).toHaveLength(1);
  });

  it("DeleteClass elimina en cascada las asociaciones que la referencian", () => {
    const model = baseModel();
    const withAssoc = applyCommand(
      model,
      cmd({ type: "CreateClass", payload: { id: "cls-02", name: "Categoria" } }),
    );
    const withAssoc2 = applyCommand(withAssoc.model, {
      ...cmd({
        type: "CreateAssociation",
        payload: {
          id: "assoc-01",
          sourceClassId: "cls-01",
          targetClassId: "cls-02",
          sourceMultiplicity: "0..*",
          targetMultiplicity: "1",
          navigability: "unidirectional",
        },
      }),
      modelVersion: "1.0.1",
    });
    expect(withAssoc2.result).toBe("accepted");

    const outcome = applyCommand(withAssoc2.model, {
      ...cmd({ type: "DeleteClass", payload: { classId: "cls-02" } }),
      modelVersion: "1.0.2",
    });
    expect(outcome.result).toBe("accepted");
    expect(outcome.model.classes.some((c) => c.id === "cls-02")).toBe(false);
    expect(outcome.model.associations).toHaveLength(0);
  });

  it("UpdateAttribute sin campos modificables es noop sin mutación ni incremento", () => {
    const model = baseModel();
    const outcome = applyCommand(
      model,
      cmd({ type: "UpdateAttribute", payload: { attributeId: "attr-x", classId: "cls-01" } }),
    );
    // attr-x no existe -> rechazado por ATTRIBUTE_NOT_FOUND
    expect(outcome.result).toBe("rejected");
    expect(outcome.errors.map((e) => e.code)).toContain("ATTRIBUTE_NOT_FOUND");

    const withAttr = applyCommand(
      model,
      cmd({
        type: "AddAttribute",
        payload: { id: "attr-x", classId: "cls-01", name: "sku", type: "String", nullable: false, multiplicity: "1" },
      }),
    );
    const noopOutcome = applyCommand(withAttr.model, {
      ...cmd({ type: "UpdateAttribute", payload: { attributeId: "attr-x", classId: "cls-01" } }),
      modelVersion: "1.0.1",
    });
    expect(noopOutcome.result).toBe("noop");
    expect(noopOutcome.model).toBe(withAttr.model);
    expect(noopOutcome.modelVersion).toBe("1.0.1");
  });

  it("CreateAssociation rechaza auto-asociación", () => {
    const outcome = applyCommand(
      baseModel(),
      cmd({
        type: "CreateAssociation",
        payload: {
          id: "assoc-01",
          sourceClassId: "cls-01",
          targetClassId: "cls-01",
          sourceMultiplicity: "1",
          targetMultiplicity: "1",
          navigability: "bidirectional",
        },
      }),
    );
    expect(outcome.result).toBe("rejected");
    expect(outcome.errors.map((e) => e.code)).toContain("SELF_ASSOCIATION_NOT_ALLOWED");
  });

  it("CreatePackage/DeletePackage validan existencia, unicidad y vacío", () => {
    const model = baseModel();
    const dup = applyCommand(model, cmd({ type: "CreatePackage", payload: { id: "pkg-02", name: "ventas" } }));
    expect(dup.errors.map((e) => e.code)).toContain("DUPLICATE_PACKAGE_NAME");

    const notEmpty = applyCommand(model, cmd({ type: "DeletePackage", payload: { packageId: "pkg-01" } }));
    expect(notEmpty.errors.map((e) => e.code)).toContain("PACKAGE_NOT_EMPTY");
  });
});

describe("serialización canónica y hashing", () => {
  it("stableStringify ordena claves recursivamente", () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it("modelSha256 es invariante al orden de arrays (orden canónico §4)", () => {
    const a = baseModel();
    const shuffled: DomainModel = {
      ...a,
      packages: [...a.packages].reverse(),
      classes: [...a.classes].reverse(),
      associations: [...a.associations].reverse(),
    };
    expect(modelSha256(a)).toBe(modelSha256(shuffled));
    expect(stableStringify(canonicalizeModel(a))).toBe(stableStringify(canonicalizeModel(shuffled)));
  });
});
