import path from "node:path";
import { GeneratorError, GeneratorErrorCode } from "./errors.js";

/**
 * Entrada del plan de escritura: ruta relativa POSIX dentro de `outputDir`
 * más el contenido (o un productor perezoso evaluado dentro del staging,
 * para que un fallo de contenido no deje salida parcial).
 */
export interface PlannedFile {
  relativePath: string;
  content: string | (() => string);
}

/** Normaliza una ruta relativa a formato POSIX (`a/b/c`), colapsando `.` y `..`. */
export function normalizeRelativePath(relativePath: string): string {
  return path.posix.normalize(relativePath.replace(/\\/g, "/"));
}

function isContained(outputDir: string, relativePath: string): boolean {
  const root = path.resolve(outputDir);
  const resolved = path.resolve(root, relativePath);
  return resolved.startsWith(root + path.sep);
}

/**
 * Construye el plan de escritura ordenado:
 *
 * - Normaliza las rutas relativas a POSIX.
 * - Rechaza rutas absolutas o que escapen del `outputDir`
 *   (PATH_OUTSIDE_OUTPUT_DIR) y rutas vacías o duplicadas
 *   (INVALID_OUTPUT_PATH — código de extensión documentado).
 * - Devuelve las entradas ordenadas por `relativePath` ASC, por lo que el
 *   orden de escritura es estable e independiente del orden de entrada.
 */
export function buildWritePlan(files: PlannedFile[], outputDir: string): PlannedFile[] {
  const seen = new Map<string, number>();

  const normalized = files.map((file, index) => {
    const relativePath = normalizeRelativePath(file.relativePath);

    if (relativePath.length === 0 || relativePath === ".") {
      throw new GeneratorError(
        GeneratorErrorCode.INVALID_OUTPUT_PATH,
        `La ruta de salida '${file.relativePath}' no es válida.`,
      );
    }
    if (
      path.isAbsolute(file.relativePath) ||
      path.win32.isAbsolute(file.relativePath) ||
      path.posix.isAbsolute(file.relativePath) ||
      !isContained(outputDir, relativePath)
    ) {
      throw new GeneratorError(
        GeneratorErrorCode.PATH_OUTSIDE_OUTPUT_DIR,
        `La ruta de salida '${file.relativePath}' queda fuera del directorio de destino.`,
      );
    }

    const first = seen.get(relativePath);
    if (first !== undefined) {
      throw new GeneratorError(
        GeneratorErrorCode.INVALID_OUTPUT_PATH,
        `La ruta de salida '${relativePath}' está duplicada en el plan (entradas ${first} y ${index}).`,
      );
    }
    seen.set(relativePath, index);

    return { ...file, relativePath };
  });

  return normalized.sort((a, b) => (a.relativePath < b.relativePath ? -1 : 1));
}
