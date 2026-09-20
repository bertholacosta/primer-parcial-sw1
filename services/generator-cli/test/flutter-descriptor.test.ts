import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalize, type DomainModel } from "domain-model";
import { generate, type GenerateSuccess } from "../src/generate.js";
import { canonicalJson, sha256Hex } from "../src/model-io.js";
import {
  isLazyLoadable,
  relationTypeFor,
  uiTypeFor,
} from "../src/flutter-descriptor.js";
import { GeneratorError, GeneratorErrorCode } from "../src/errors.js";

const tmpDirs: string[] = [];

function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "generator-cli-descriptor-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function fixturePath(name: string): string {
  return fileURLToPath(new URL(`../../../fixtures/models/${name}`, import.meta.url));
}

function configFor(outputDir: string) {
  return {
    outputDir,
    basePackage: "com.example.biblioteca",
    artifactId: "biblioteca",
    groupId: "com.example",
    generatorVersion: "0.1.0",
    templateSetId: "spring-boot-jpa-v1",
  };
}

function generateMinimal(): { out: string; descriptor: Record<string, unknown> } {
  const out = path.join(tmp(), "salida");
  const result = generate({
    modelPath: fixturePath("valid-minimal.json"),
    config: configFor(out),
  }) as GenerateSuccess;
  expect(result.outcome).toBe("succeeded");
  const descriptor = JSON.parse(
    fs.readFileSync(path.join(out, "flutter-descriptor.json"), "utf8"),
  );
  return { out, descriptor };
}

const UI_TYPE_CASES: [string, string, string][] = [
  ["String", "1", "textField"],
  ["String", "0..1", "textField"],
  ["String", "1..*", "textList"],
  ["String", "0..*", "textList"],
  ["Integer", "1", "integerField"],
  ["Integer", "0..*", "integerField"],
  ["Long", "1", "integerField"],
  ["Double", "0..1", "decimalField"],
  ["Boolean", "1", "checkbox"],
  ["Date", "1", "datePicker"],
  ["DateTime", "1", "dateTimePicker"],
  ["UUID", "0..1", "uuidField"],
];

const RELATION_TYPE_CASES: [string, string, string, boolean][] = [
  ["1", "0..1", "oneToOne", false],
  ["0..*", "1", "manyToOne", false],
  ["1..*", "0..1", "manyToOne", false],
  ["1", "1..*", "oneToMany", true],
  ["0..1", "0..*", "oneToMany", true],
  ["0..*", "1..*", "manyToMany", true],
];

describe("descriptor Flutter — mapeos deterministas (contrato flutter-descriptor v1 §4, §5)", () => {
  it.each(UI_TYPE_CASES)("uiType: %s/%s → %s", (type, multiplicity, expected) => {
    expect(uiTypeFor(type, multiplicity as never)).toBe(expected);
  });

  it("tipo sin mapeo → DESCRIPTOR_TYPE_MAPPING_ERROR", () => {
    try {
      uiTypeFor("Enum", "1" as never);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(GeneratorError);
      expect((err as GeneratorError).code).toBe(
        GeneratorErrorCode.DESCRIPTOR_TYPE_MAPPING_ERROR,
      );
    }
  });

  it.each(RELATION_TYPE_CASES)(
    "relationType: %s → %s = %s (lazy=%s)",
    (src, tgt, expected, lazy) => {
      const relationType = relationTypeFor(src as never, tgt as never);
      expect(relationType).toBe(expected);
      expect(isLazyLoadable(relationType)).toBe(lazy);
    },
  );
});

describe("descriptor Flutter — documento generado conforme al contrato v1", () => {
  it("declara identidad y trazabilidad de origen (§2.2, invariante I1)", () => {
    const { out, descriptor } = generateMinimal();
    const model = canonicalize(
      JSON.parse(fs.readFileSync(fixturePath("valid-minimal.json"), "utf8")) as DomainModel,
    );

    expect(descriptor.descriptorContractVersion).toBe("1");
    expect(descriptor.descriptorVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(descriptor.sourceModelId).toBe(model.id);
    expect(descriptor.sourceModelVersion).toBe(model.version);
    expect(descriptor.sourceModelContractVersion).toBe("1");
    expect(descriptor.sourceModelSha256).toBe(sha256Hex(canonicalJson(model)));
    expect(descriptor.generatorVersion).toBe("0.1.0");
    expect(Array.isArray(descriptor.classes)).toBe(true);
    expect(Array.isArray(descriptor.associations)).toBe(true);

    // §5.3 del contrato del generador: el descriptor entra en el manifiesto.
    const manifest = JSON.parse(
      fs.readFileSync(path.join(out, "generation-manifest.json"), "utf8"),
    );
    const entry = manifest.files.find(
      (f: { path: string }) => f.path === "flutter-descriptor.json",
    );
    expect(entry).toBeDefined();
    expect(entry.sha256).toBe(
      sha256Hex(fs.readFileSync(path.join(out, "flutter-descriptor.json"), "utf8")),
    );
  });

  it("proyecta clases y atributos en orden canónico §6 con uiType y required correctos", () => {
    const { descriptor } = generateMinimal();
    const classes = descriptor.classes as Record<string, unknown>[];

    expect(classes.map((c) => c.id)).toEqual(
      [...classes.map((c) => c.id)].sort(),
    );

    const libro = classes.find((c) => c.id === "cls-01")!;
    expect(libro.name).toBe("Libro");
    expect(libro.packageName).toBe("biblioteca");
    expect(libro.isAbstract).toBe(false);

    const attrs = libro.attributes as Record<string, unknown>[];
    expect(attrs.map((a) => a.id)).toEqual([...attrs.map((a) => a.id)].sort());

    const titulo = attrs.find((a) => a.id === "attr-01")!;
    expect(titulo).toMatchObject({
      name: "titulo",
      type: "String",
      nullable: false,
      multiplicity: "1",
      uiType: "textField",
      required: true,
    });

    const fecha = attrs.find((a) => a.id === "attr-03")!;
    expect(fecha).toMatchObject({
      name: "fechaPublicacion",
      type: "Date",
      nullable: true,
      multiplicity: "0..1",
      uiType: "datePicker",
      required: false,
    });
  });

  it("proyecta asociaciones con relationType e isLazyLoadable deterministas (ejemplo normativo §10.1)", () => {
    const { descriptor } = generateMinimal();
    const associations = descriptor.associations as Record<string, unknown>[];

    expect(associations).toHaveLength(1);
    expect(associations[0]).toMatchObject({
      id: "assoc-01",
      name: "escritoPor",
      sourceClassId: "cls-01",
      targetClassId: "cls-02",
      sourceMultiplicity: "0..*",
      targetMultiplicity: "1..*",
      navigability: "bidirectional",
      relationType: "manyToMany",
      isLazyLoadable: true,
    });
  });

  it("es reproducible byte a byte entre ejecuciones equivalentes (invariante I3)", () => {
    const dir = tmp();
    const read = (name: string) =>
      fs.readFileSync(path.join(dir, name, "flutter-descriptor.json"));
    expect(
      generate({ modelPath: fixturePath("valid-minimal.json"), config: configFor(path.join(dir, "run1")) }).outcome,
    ).toBe("succeeded");
    expect(
      generate({ modelPath: fixturePath("valid-minimal.json"), config: configFor(path.join(dir, "run2")) }).outcome,
    ).toBe("succeeded");
    expect(read("run1").equals(read("run2"))).toBe(true);
  });
});
