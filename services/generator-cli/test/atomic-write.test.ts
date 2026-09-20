import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writePlanAtomically } from "../src/atomic-write.js";
import { buildWritePlan } from "../src/write-plan.js";
import { GeneratorError } from "../src/errors.js";

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

describe("escritura atómica del plan (§9.1)", () => {
  it("escribe el plan completo en el directorio de destino", () => {
    const out = path.join(tmp(), "salida");
    const plan = buildWritePlan(
      [
        { relativePath: "a/b.txt", content: "contenido-b" },
        { relativePath: "a/c.txt", content: "contenido-c" },
      ],
      out,
    );
    writePlanAtomically(out, plan);
    expect(fs.readFileSync(path.join(out, "a/b.txt"), "utf8")).toBe("contenido-b");
    expect(fs.readFileSync(path.join(out, "a/c.txt"), "utf8")).toBe("contenido-c");
  });

  it("ante un fallo a mitad de escritura no deja salida parcial ni staging", () => {
    const parent = tmp();
    const out = path.join(parent, "salida");
    const plan = buildWritePlan(
      [
        { relativePath: "a/ok.txt", content: "ok" },
        {
          relativePath: "a/falla.txt",
          content: () => {
            throw new Error("fallo simulado de productor");
          },
        },
      ],
      out,
    );

    expect(() => writePlanAtomically(out, plan)).toThrowError();
    expect(fs.existsSync(out)).toBe(false);
    const leftovers = fs.readdirSync(parent).filter((e) => e.includes(".tmp-"));
    expect(leftovers).toEqual([]);
  });

  it("rechaza un directorio de salida no vacío", () => {
    const out = path.join(tmp(), "salida");
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, "previo.txt"), "x");
    try {
      writePlanAtomically(out, [{ relativePath: "a.txt", content: "x" }]);
      expect.unreachable();
    } catch (err) {
      expect((err as GeneratorError).code).toBe("OUTPUT_DIR_NOT_EMPTY");
    }
  });

  it("acepta un directorio de salida existente pero vacío", () => {
    const out = path.join(tmp(), "salida");
    fs.mkdirSync(out, { recursive: true });
    writePlanAtomically(out, [{ relativePath: "a.txt", content: "x" }]);
    expect(fs.readFileSync(path.join(out, "a.txt"), "utf8")).toBe("x");
  });
});
