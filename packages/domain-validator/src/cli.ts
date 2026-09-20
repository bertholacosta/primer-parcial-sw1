#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { validate } from "./validate.js";

function main(argv: string[]): number {
  const file = argv[2];
  if (!file) {
    console.error("Uso: domain-validate <archivo.domain-model.json>");
    return 2;
  }

  let doc: unknown;
  try {
    doc = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    console.error(`No se pudo leer o parsear '${file}': ${(err as Error).message}`);
    return 2;
  }

  const result = validate(doc);
  const diagnostics = [...result.errors, ...result.warnings];
  for (const d of diagnostics) {
    console.log(`${d.severity} ${d.code} ${d.path} - ${d.message}`);
  }
  if (diagnostics.length === 0) {
    console.log("OK: el documento satisface el contrato domain-model v1.");
  }
  return result.errors.length > 0 ? 1 : 0;
}

process.exit(main(process.argv));
