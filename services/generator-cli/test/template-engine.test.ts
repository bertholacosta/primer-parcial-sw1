import { describe, expect, it } from "vitest";
import { buildTemplateContext } from "../src/template-engine.js";
import type { GenerationConfig } from "../src/config.js";

const cfg: GenerationConfig = {
  outputDir: "out",
  basePackage: "org.test",
  artifactId: "test-app",
  groupId: "org.test",
  generatorVersion: "1",
  templateSetId: "spring-boot-v1",
};

describe("template engine", () => {
  it("deriva el nombre de tabla del nombre de la clase en el paquete raíz", () => {
    const ctx = buildTemplateContext(
      {
        contractVersion: "1",
        id: "m1",
        name: "Test",
        version: "1.0.0",
        classes: [
          { id: "c1", name: "User", attributes: [] },
          { id: "c2", name: "Order", attributes: [] }
        ],
        associations: []
      },
      { id: "c1", name: "User", attributes: [] },
      cfg
    );
    expect(ctx.tableName).toBe("user");
  });
});

describe("tipos de relación UML (ADR-0009)", () => {
  const model = {
    id: "m1",
    name: "Test",
    classes: [
      { id: "padre", name: "Padre", attributes: [] },
      { id: "hija", name: "Hija", attributes: [] },
      { id: "todo", name: "Todo", attributes: [] },
      { id: "parte", name: "Parte", attributes: [] },
      { id: "grupo", name: "Grupo", attributes: [] },
      { id: "miembro", name: "Miembro", attributes: [] },
      { id: "cliente", name: "Cliente", attributes: [] },
      { id: "servicio", name: "Servicio", attributes: [] },
      { id: "a", name: "A", attributes: [] },
      { id: "b", name: "B", attributes: [] },
      { id: "vinculo", name: "Vinculo", attributes: [{ id: "at1", name: "fecha", type: "Date", nullable: false, multiplicity: "1" }] },
    ],
    associations: [
      { id: "g1", kind: "generalization", sourceClassId: "hija", targetClassId: "padre", sourceMultiplicity: "1", targetMultiplicity: "1", navigability: "unidirectional" },
      { id: "c1", kind: "composition", sourceClassId: "todo", targetClassId: "parte", sourceMultiplicity: "1", targetMultiplicity: "0..*", navigability: "unidirectional" },
      { id: "ag1", kind: "aggregation", sourceClassId: "grupo", targetClassId: "miembro", sourceMultiplicity: "1", targetMultiplicity: "0..*", navigability: "unidirectional" },
      { id: "d1", kind: "dependency", sourceClassId: "cliente", targetClassId: "servicio", sourceMultiplicity: "1", targetMultiplicity: "1", navigability: "unidirectional" },
      { id: "ac1", kind: "associationClass", sourceClassId: "a", targetClassId: "b", sourceMultiplicity: "1", targetMultiplicity: "0..*", navigability: "bidirectional", associationClassId: "vinculo" },
    ],
  };
  const cls = (id: string) => model.classes.find(c => c.id === id)!;
  const ctx = (id: string) => buildTemplateContext(model as never, cls(id) as never, cfg);

  it("generalization: hija extiende al padre y no redeclara id", () => {
    const hija = ctx("hija");
    expect(hija.extendsClass).toBe("PadreEntity");
    expect(hija.hasDefaultId).toBe(false);
    expect(hija.associations).toEqual([]);
    expect(ctx("padre").isInheritanceRoot).toBe(true);
  });

  it("composition: cascade ALL + orphanRemoval en el todo", () => {
    const todo = ctx("todo");
    const rel = todo.associations.find(a => a.relatedClassId === "parte")!;
    expect(rel.annotationFull).toContain("CascadeType.ALL");
    expect(rel.annotationFull).toContain("orphanRemoval = true");
  });

  it("aggregation: cascade débil sin orphanRemoval", () => {
    const grupo = ctx("grupo");
    const rel = grupo.associations.find(a => a.relatedClassId === "miembro")!;
    expect(rel.annotationFull).toContain("CascadeType.PERSIST");
    expect(rel.annotationFull).not.toContain("orphanRemoval");
  });

  it("dependency: no genera campo persistente", () => {
    expect(ctx("cliente").associations).toEqual([]);
    expect(ctx("servicio").associations).toEqual([]);
  });

  it("associationClass: la clase portadora enlaza ambos extremos con @ManyToOne", () => {
    const vinculo = ctx("vinculo");
    const targets = vinculo.associations.map(a => a.relatedClassId).sort();
    expect(targets).toEqual(["a", "b"]);
    expect(vinculo.associations.every(a => a.annotation === "@ManyToOne")).toBe(true);
    // Los extremos no reciben campo por la clase-asociación
    expect(ctx("a").associations).toEqual([]);
    expect(ctx("b").associations).toEqual([]);
  });
});
