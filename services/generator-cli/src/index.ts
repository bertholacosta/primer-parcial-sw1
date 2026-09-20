#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import path from "node:path";
import { parseCliArgs, USAGE } from "./cli-args.js";
import { loadConfigFile } from "./config.js";
import { generate } from "./generate.js";
import {
  GeneratorError,
  GeneratorErrorCode,
  toErrorReport,
  type GeneratorErrorEntry,
} from "./errors.js";

export const ERROR_REPORT_FILE_NAME = "generation-error.json";

/** Emite el informe de error §9.3 en stderr y en `generation-error.json` (cwd). */
export function emitErrorReport(errors: GeneratorErrorEntry[], cwd = process.cwd()): string {
  const text = JSON.stringify(toErrorReport(errors), null, 2) + "\n";
  process.stderr.write(text);
  try {
    writeFileSync(path.join(cwd, ERROR_REPORT_FILE_NAME), text, "utf8");
  } catch {
    // El informe ya se emitió por stderr; la escritura del fichero es best-effort.
  }
  return text;
}

function main(argv: string[]): number {
  const args = parseCliArgs(argv.slice(2));

  if (args.help) {
    process.stdout.write(USAGE + "\n");
    return 0;
  }
  if (args.modelPath === undefined || args.configPath === undefined) {
    process.stderr.write(USAGE + "\n");
    return 2;
  }

  let rawConfig: unknown;
  try {
    rawConfig = loadConfigFile(args.configPath);
  } catch (err) {
    const entry =
      err instanceof GeneratorError
        ? err.toEntry()
        : { code: GeneratorErrorCode.INTERNAL_ERROR, message: (err as Error).message };
    emitErrorReport([entry]);
    return 1;
  }

  if (args.outputDir !== undefined) {
    (rawConfig as Record<string, unknown>).outputDir = args.outputDir;
  }

  const result = generate({ modelPath: args.modelPath, config: rawConfig });

  if (result.outcome === "failed") {
    emitErrorReport(result.errors);
    return 1;
  }

  process.stdout.write(
    JSON.stringify(
      {
        outcome: "succeeded",
        outputDir: result.outputDir,
        filesWritten: result.filesWritten,
        warnings: result.warnings,
      },
      null,
      2,
    ) + "\n",
  );
  return 0;
}

process.exitCode = main(process.argv);
