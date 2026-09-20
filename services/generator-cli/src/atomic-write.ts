import fs from "node:fs";
import path from "node:path";
import { GeneratorError, GeneratorErrorCode } from "./errors.js";
import type { PlannedFile } from "./write-plan.js";

/**
 * Comprueba que `outputDir` no existe o es un directorio vacío (§3.2: el
 * generador no sobreescribe ejecuciones anteriores en el mismo directorio).
 */
export function ensureOutputDirAvailable(outputDir: string): void {
  if (!fs.existsSync(outputDir)) return;
  const stat = fs.statSync(outputDir);
  if (!stat.isDirectory() || fs.readdirSync(outputDir).length > 0) {
    throw new GeneratorError(
      GeneratorErrorCode.OUTPUT_DIR_NOT_EMPTY,
      `El directorio de salida '${outputDir}' ya contiene ficheros.`,
    );
  }
}

function resolveContent(content: PlannedFile["content"]): string {
  return typeof content === "function" ? content() : content;
}

/**
 * Escritura atómica del plan (§9.1): todos los ficheros se materializan en
 * un directorio de staging hermano del `outputDir` y, solo cuando el plan
 * completo se ha escrito, el staging se renombra al destino final. Ante
 * cualquier error el staging se elimina y el `outputDir` no queda creado ni
 * con contenido parcial.
 */
export function writePlanAtomically(outputDir: string, plan: PlannedFile[]): void {
  ensureOutputDirAvailable(outputDir);

  const target = path.resolve(outputDir);
  const parent = path.dirname(target);
  try {
    fs.mkdirSync(parent, { recursive: true });
  } catch (err) {
    throw new GeneratorError(
      GeneratorErrorCode.IO_ERROR,
      `No se pudo crear el directorio padre de '${outputDir}': ${(err as Error).message}`,
    );
  }

  let staging: string;
  try {
    staging = fs.mkdtempSync(path.join(parent, `.${path.basename(target)}.tmp-`));
  } catch (err) {
    throw new GeneratorError(
      GeneratorErrorCode.IO_ERROR,
      `No se pudo crear el directorio de staging: ${(err as Error).message}`,
    );
  }

  try {
    for (const file of plan) {
      const absolute = path.join(staging, file.relativePath);
      try {
        fs.mkdirSync(path.dirname(absolute), { recursive: true });
        fs.writeFileSync(absolute, resolveContent(file.content), "utf8");
      } catch (err) {
        if (err instanceof GeneratorError) throw err;
        throw new GeneratorError(
          file.writeErrorCode ?? GeneratorErrorCode.IO_ERROR,
          `Error de escritura en '${file.relativePath}': ${(err as Error).message}`,
        );
      }
    }
    if (fs.existsSync(target)) fs.rmdirSync(target);
    fs.renameSync(staging, target);
  } catch (err) {
    fs.rmSync(staging, { recursive: true, force: true });
    if (err instanceof GeneratorError) throw err;
    throw new GeneratorError(
      GeneratorErrorCode.IO_ERROR,
      `Error de escritura en '${outputDir}': ${(err as Error).message}`,
    );
  }
}
