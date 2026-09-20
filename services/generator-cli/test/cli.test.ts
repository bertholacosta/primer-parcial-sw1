import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ERROR_REPORT_PATH = path.join(__dirname, "generation-error.json");

describe("CLI - errores estables", () => {
  it("emite un único documento JSON en stderr en caso de error", () => {
    fs.rmSync(ERROR_REPORT_PATH, { force: true });
    try {
      execSync("node ../dist/index.js --model no-existe.json --config no-existe.json", {
        cwd: __dirname,
        stdio: ["ignore", "pipe", "pipe"],
      });
      expect.fail("Debería haber fallado");
    } catch (err: any) {
      if (err.stderr === undefined) throw err;
      const stderr = err.stderr.toString("utf8");
      // Debe ser parseable como JSON sin texto extra
      expect(() => JSON.parse(stderr)).not.toThrow();
      const parsed = JSON.parse(stderr);
      expect(parsed.errors).toBeDefined();
    } finally {
      fs.rmSync(ERROR_REPORT_PATH, { force: true });
    }
  });
});
