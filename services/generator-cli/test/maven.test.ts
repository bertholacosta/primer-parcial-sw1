import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("Compilacion Maven", () => {
  it("compila el proyecto generado exitosamente", () => {
    // Solo comprobamos si mvn está instalado, si no, lo saltamos.
    try {
      execSync("mvn -v", { stdio: "ignore" });
    } catch {
      console.log("Maven no disponible, saltando prueba");
      return;
    }
    
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mvn-test-"));
    try {
      execSync(`node ../dist/index.js --model ../../../fixtures/models/valid-minimal.json --config ./test-config.json --output ` + tmp, { cwd: __dirname });
      // Run mvn package (no tests)
      execSync("mvn clean package -DskipTests", { cwd: tmp, stdio: "inherit" });
      expect(fs.existsSync(path.join(tmp, "target"))).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }, 180000); // 3 minutes timeout
});
