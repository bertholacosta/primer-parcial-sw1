import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generate, type GenerateFailure, type GenerateSuccess } from "../src/generate.js";

const tmpDirs: string[] = [];

function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "generator-cli-test-"));
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

function configFor(outputDir: string, overrides: Record<string, unknown> = {}) {
  return {
    outputDir,
    basePackage: "com.example.biblioteca",
    artifactId: "biblioteca",
    groupId: "com.example",
    generatorVersion: "0.1.0",
    templateSetId: "spring-boot-jpa-v1",
    ...overrides,
  };
}

function run(modelPath: string, outputDir: string, configOverrides = {}) {
  return generate({ modelPath, config: configFor(outputDir, configOverrides) });
}

function failure(result: ReturnType<typeof generate>): GenerateFailure {
  expect(result.outcome).toBe("failed");
  return result as GenerateFailure;
}

describe("núcleo del generador — errores estables y atomicidad (aceptación P2-003)", () => {
  it("modelo inexistente → MODEL_NOT_FOUND y sin salida", () => {
    const out = path.join(tmp(), "salida");
    const result = failure(run(path.join(tmp(), "no-existe.json"), out));
    expect(result.errors[0].code).toBe("MODEL_NOT_FOUND");
    expect(fs.existsSync(out)).toBe(false);
  });

  it("JSON inválido → MODEL_NOT_VALID_JSON y sin salida", () => {
    const dir = tmp();
    const modelPath = path.join(dir, "roto.json");
    fs.writeFileSync(modelPath, "{ no-json", "utf8");
    const out = path.join(dir, "salida");
    const result = failure(run(modelPath, out));
    expect(result.errors[0].code).toBe("MODEL_NOT_VALID_JSON");
    expect(fs.existsSync(out)).toBe(false);
  });

  it("contractVersion distinta → UNSUPPORTED_MODEL_CONTRACT_VERSION y sin salida", () => {
    const out = path.join(tmp(), "salida");
    const result = failure(run(fixturePath("invalid-unsupported-contract-version.json"), out));
    expect(result.errors[0].code).toBe("UNSUPPORTED_MODEL_CONTRACT_VERSION");
    expect(fs.existsSync(out)).toBe(false);
  });

  it("modelo con errores del validador → INVALID_MODEL con diagnósticos y sin salida parcial", () => {
    const out = path.join(tmp(), "salida");
    const result = failure(run(fixturePath("invalid-unknown-type.json"), out));
    expect(result.errors[0].code).toBe("INVALID_MODEL");
    expect(result.errors[0].diagnostics?.length).toBeGreaterThan(0);
    expect(result.errors[0].diagnostics?.[0].code).toBe("UNKNOWN_TYPE");
    expect(fs.existsSync(out)).toBe(false);
    expect(fs.readdirSync(path.dirname(out))).not.toContain(path.basename(out));
  });

  it("outputDir no vacío → OUTPUT_DIR_NOT_EMPTY", () => {
    const out = path.join(tmp(), "salida");
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, "previo.txt"), "x");
    const result = failure(run(fixturePath("valid-minimal.json"), out));
    expect(result.errors[0].code).toBe("OUTPUT_DIR_NOT_EMPTY");
  });

  it("basePackage inválido → INVALID_BASE_PACKAGE", () => {
    const result = failure(
      run(fixturePath("valid-minimal.json"), path.join(tmp(), "salida"), {
        basePackage: "9bad..pkg",
      }),
    );
    expect(result.errors[0].code).toBe("INVALID_BASE_PACKAGE");
  });

  it("artifactId inválido → INVALID_ARTIFACT_ID", () => {
    const result = failure(
      run(fixturePath("valid-minimal.json"), path.join(tmp(), "salida"), {
        artifactId: "Bad-Id",
      }),
    );
    expect(result.errors[0].code).toBe("INVALID_ARTIFACT_ID");
  });

  it("campo de configuración obligatorio ausente → INVALID_CONFIG", () => {
    const result = failure(
      run(fixturePath("valid-minimal.json"), path.join(tmp(), "salida"), {
        generatorVersion: "",
      }),
    );
    expect(result.errors[0].code).toBe("INVALID_CONFIG");
  });
});

describe("núcleo del generador — salida exitosa y reproducibilidad", () => {
  it("escribe el manifiesto conforme a §5.2 y devuelve advertencias no bloqueantes", () => {
    const out = path.join(tmp(), "salida");
    const result = run(fixturePath("valid-minimal.json"), out) as GenerateSuccess;
    expect(result.outcome).toBe("succeeded");
    expect(result.filesWritten).toContain("generation-manifest.json");
    expect(result.filesWritten).toContain("flutter-descriptor.json");
    expect(result.filesWritten).toHaveLength(15);
    expect(result.plannedArtifacts).toHaveLength(10);

    const manifest = JSON.parse(
      fs.readFileSync(path.join(out, "generation-manifest.json"), "utf8"),
    );
    expect(manifest.generatorContractVersion).toBe("1");
    expect(manifest.generatorVersion).toBe("0.1.0");
    expect(manifest.templateSetId).toBe("spring-boot-jpa-v1");
    expect(manifest.modelId).toBe("3f2504e0-4f89-11d3-9a0c-0305e82c3301");
    expect(manifest.modelVersion).toBe("1.0.0");
    expect(manifest.modelContractVersion).toBe("1");
    expect(manifest.modelSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.basePackage).toBe("com.example.biblioteca");
    expect(manifest.artifactId).toBe("biblioteca");
    expect(manifest.groupId).toBe("com.example");
    expect(manifest.files).toHaveLength(14);
    expect(manifest.files.map((f: { path: string }) => f.path)).toContain("flutter-descriptor.json");

    const autorPath = path.join(out, "src/main/java/com/example/biblioteca/entity/AutorEntity.java");
    expect(fs.existsSync(autorPath)).toBe(true);
    const content = fs.readFileSync(autorPath, "utf8");
    expect(content).toContain('mappedBy = "escritoPors"');
    expect(content).toContain('private List<LibroEntity> libros;');
  });

  it("dos ejecuciones con la misma entrada producen manifiestos byte a byte idénticos", () => {
    const dir = tmp();
    const out1 = path.join(dir, "run1");
    const out2 = path.join(dir, "run2");
    expect(run(fixturePath("valid-minimal.json"), out1).outcome).toBe("succeeded");
    expect(run(fixturePath("valid-minimal.json"), out2).outcome).toBe("succeeded");
    const m1 = fs.readFileSync(path.join(out1, "generation-manifest.json"));
    const m2 = fs.readFileSync(path.join(out2, "generation-manifest.json"));
    expect(m1.equals(m2)).toBe(true);
  });

  it("modelo canónicamente igual pero con orden distinto → mismo modelSha256", () => {
    const dir = tmp();
    const unordered = {
      contractVersion: "1",
      id: "m-x",
      name: "M",
      version: "1.0.0",
      classes: [
        { id: "cls-2", name: "B", attributes: [] },
        { id: "cls-1", name: "A", attributes: [] },
      ],
      associations: [],
    };
    const ordered = { ...unordered, classes: [...unordered.classes].reverse() };
    const p1 = path.join(dir, "unordered.json");
    const p2 = path.join(dir, "ordered.json");
    fs.writeFileSync(p1, JSON.stringify(unordered), "utf8");
    fs.writeFileSync(p2, JSON.stringify(ordered), "utf8");

    const r1 = run(p1, path.join(dir, "o1")) as GenerateSuccess;
    const r2 = run(p2, path.join(dir, "o2")) as GenerateSuccess;
    expect(r1.outcome).toBe("succeeded");
    expect(r2.outcome).toBe("succeeded");
    const s1 = JSON.parse(fs.readFileSync(path.join(dir, "o1", "generation-manifest.json"), "utf8")).modelSha256;
    const s2 = JSON.parse(fs.readFileSync(path.join(dir, "o2", "generation-manifest.json"), "utf8")).modelSha256;
    expect(s1).toBe(s2);
  });

  it("advertencias del validador no bloquean la generación", () => {
    const out = path.join(tmp(), "salida");
    const result = run(fixturePath("warning-nullable-required-conflict.json"), out) as GenerateSuccess;
    expect(result.outcome).toBe("succeeded");
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0].severity).toBe("WARNING");
  });
});
