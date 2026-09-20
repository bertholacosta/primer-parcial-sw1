import { describe, expect, it } from "vitest";
import { buildWritePlan } from "../src/write-plan.js";
import { GeneratorError } from "../src/errors.js";

const OUT = "out/projecto";

function planOf(...paths: string[]) {
  return paths.map((relativePath) => ({ relativePath, content: "x" }));
}

describe("plan de escritura ordenado y contenido (aceptación P2-003)", () => {
  it("ordena las entradas por ruta relativa ASC (orden estable)", () => {
    const plan = buildWritePlan(
      planOf("b/z.txt", "a/y.txt", "b/a.txt", "a/x.txt"),
      OUT,
    );
    expect(plan.map((f) => f.relativePath)).toEqual([
      "a/x.txt",
      "a/y.txt",
      "b/a.txt",
      "b/z.txt",
    ]);
  });

  it("produce el mismo orden independientemente del orden de entrada", () => {
    const a = buildWritePlan(planOf("b/z.txt", "a/x.txt"), OUT);
    const b = buildWritePlan(planOf("a/x.txt", "b/z.txt"), OUT);
    expect(a).toEqual(b);
  });

  it("normaliza separadores Windows a POSIX", () => {
    const plan = buildWritePlan(planOf("a\\b\\c.txt"), OUT);
    expect(plan[0].relativePath).toBe("a/b/c.txt");
  });

  it.each([
    "../escape.txt",
    "a/../../escape.txt",
    "..\\escape.txt",
    "/abs/escape.txt",
    "C:/abs/escape.txt",
    "C:\\abs\\escape.txt",
  ])("rechaza rutas fuera del destino: %s", (relativePath) => {
    expect(() => buildWritePlan(planOf(relativePath), OUT)).toThrowError(GeneratorError);
    try {
      buildWritePlan(planOf(relativePath), OUT);
    } catch (err) {
      expect((err as GeneratorError).code).toBe("PATH_OUTSIDE_OUTPUT_DIR");
    }
  });

  it("rechaza rutas duplicadas tras normalización", () => {
    try {
      buildWritePlan(planOf("a/b.txt", "a\\b.txt"), OUT);
      expect.unreachable();
    } catch (err) {
      expect((err as GeneratorError).code).toBe("INVALID_OUTPUT_PATH");
    }
  });

  it("rechaza rutas vacías", () => {
    try {
      buildWritePlan(planOf(""), OUT);
      expect.unreachable();
    } catch (err) {
      expect((err as GeneratorError).code).toBe("INVALID_OUTPUT_PATH");
    }
  });
});
