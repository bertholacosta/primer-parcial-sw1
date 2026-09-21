/**
 * Escenario de aceptación XMI y colaboración (tarea P9-003).
 *
 * Ejecuta, sobre los fixtures versionados de `fixtures/xmi/`, las dos
 * comprobaciones del objetivo:
 *
 *   1. Round-trip XMI del corpus soportado (xmi-profile-v1):
 *      - importación de cada `input.xmi` contra `expected-canonical.json`
 *        (conformidad adicional con domain-model v1 vía domain-validator);
 *      - diagnósticos bloqueantes de cada `expected-error.json`;
 *      - exportación determinista canónico → XMI → canónico sin pérdida
 *        semántica (`canonical-input.json` / `reimport-canonical.json`).
 *
 *   2. Convergencia de dos clientes (collaboration-protocol-v1 §9) sobre un
 *      modelo canónico obtenido de un fixture versionado:
 *      - traza concurrente con rechazo determinista CONCURRENT_MODIFICATION;
 *      - reconexión con catch-up incremental;
 *      - reintento idempotente tras pérdida de la respuesta;
 *      - estado final equivalente (mismo seqNumber, versión y SHA-256) y sin
 *        elementos duplicados.
 *
 * Emite evidencia machine-readable en `--evidence <ruta>`
 * (por defecto `.validation/xmi-collaboration/evidence.json`) y termina con
 * código 0 solo si todas las comprobaciones pasan.
 *
 * Requiere los `dist/` compilados de packages/xmi-adapter,
 * packages/collaboration-protocol y packages/domain-validator
 * (los prepara scripts/validate-xmi-collaboration.ps1).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const fixturesDir = path.join(repoRoot, "fixtures", "xmi");

function parseArgs(argv) {
  const args = { evidence: path.join(repoRoot, ".validation", "xmi-collaboration", "evidence.json") };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--evidence" && i + 1 < argv.length) {
      args.evidence = path.resolve(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith("--evidence=")) {
      args.evidence = path.resolve(arg.slice("--evidence=".length));
    }
  }
  return args;
}

/** Igualdad estructural: `undefined` equivale a clave ausente (semántica toEqual). */
function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    return a.length === b.length && a.every((item, i) => deepEqual(item, b[i]));
  }
  const keysA = Object.keys(a).filter((k) => a[k] !== undefined);
  const keysB = Object.keys(b).filter((k) => b[k] !== undefined);
  return keysA.length === keysB.length && keysA.every((k) => deepEqual(a[k], b[k]));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf-8"));
}

async function importDist(relPath, packageName) {
  const distPath = path.join(repoRoot, relPath);
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Artefacto '${relPath}' no existe. Compile '${packageName}' (npm run build --prefix ${packageName}) ` +
        `o ejecute scripts/validate-xmi-collaboration.ps1.`,
    );
  }
  return import(pathToFileURL(distPath).href);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const failures = [];

  const { importXmi, exportXmi } = await importDist("packages/xmi-adapter/dist/index.js", "packages/xmi-adapter");
  const { LocalCollaborationHub, cloneModel, modelSha256 } = await importDist(
    "packages/collaboration-protocol/dist/index.js",
    "packages/collaboration-protocol",
  );
  const { validate } = await importDist("packages/domain-validator/dist/index.js", "packages/domain-validator");

  const check = (ok, label) => {
    if (!ok) failures.push(label);
    return ok;
  };

  /* -------------------------------------------------------------- */
  /* Etapa A: round-trip XMI del corpus versionado                    */
  /* -------------------------------------------------------------- */

  const corpus = [];
  const importedModels = new Map();

  const fixtureDirs = fs
    .readdirSync(fixturesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const name of fixtureDirs) {
    const dir = path.join(fixturesDir, name);
    const files = new Set(fs.readdirSync(dir));
    const rel = `fixtures/xmi/${name}`;

    if (files.has("input.xmi") && files.has("expected-canonical.json")) {
      const inputXmi = fs.readFileSync(path.join(dir, "input.xmi"), "utf-8");
      const expected = readJson(path.join(dir, "expected-canonical.json"));

      const first = importXmi(inputXmi);
      const matchesExpected = first.outcome === "success" && deepEqual(first.canonicalModel, expected);
      const validation = first.canonicalModel ? validate(first.canonicalModel) : null;
      const validatorOk = validation !== null && validation.valid === true && validation.errors.length === 0;

      // Round-trip: canónico → XMI → canónico conserva equivalencia semántica.
      let roundTripEqual = false;
      if (first.outcome === "success" && first.canonicalModel) {
        const reimported = importXmi(exportXmi(first.canonicalModel));
        roundTripEqual = reimported.outcome === "success" && deepEqual(reimported.canonicalModel, first.canonicalModel);
      }

      const ok = check(matchesExpected && validatorOk && roundTripEqual, `fixture ${name}: importación/round-trip`);
      corpus.push({
        fixture: name,
        kind: "import",
        path: rel,
        matchesExpected,
        validatorErrors: validation ? validation.errors.length : null,
        roundTripEqual,
        canonicalSha256: first.canonicalModel ? modelSha256(first.canonicalModel) : null,
        ok,
      });
      if (first.canonicalModel) importedModels.set(name, first.canonicalModel);
      console.log(`[acceptance] ${name}: import=${matchesExpected} validator=${validatorOk} roundTrip=${roundTripEqual}`);
    } else if (files.has("input.xmi") && files.has("expected-error.json")) {
      const inputXmi = fs.readFileSync(path.join(dir, "input.xmi"), "utf-8");
      const expected = readJson(path.join(dir, "expected-error.json"));

      const result = importXmi(inputXmi);
      const expectedCodes = expected.diagnostics.map((d) => d.code).sort();
      const emittedErrorCodes = result.diagnostics
        .filter((d) => d.severity === "ERROR")
        .map((d) => d.code)
        .sort();
      const codesMatch = deepEqual(emittedErrorCodes, expectedCodes);
      const noPartialModel = result.outcome === "error" && result.canonicalModel === null;

      const ok = check(codesMatch && noPartialModel, `fixture ${name}: diagnósticos de error`);
      corpus.push({
        fixture: name,
        kind: "error",
        path: rel,
        outcome: result.outcome,
        expectedCodes,
        emittedErrorCodes,
        noPartialModel,
        ok,
      });
      console.log(`[acceptance] ${name}: error=${result.outcome} codes=${emittedErrorCodes.join(",")}`);
    } else if (files.has("canonical-input.json") && files.has("reimport-canonical.json")) {
      const canonicalInput = readJson(path.join(dir, "canonical-input.json"));
      const expectedReimport = readJson(path.join(dir, "reimport-canonical.json"));

      const xmi1 = exportXmi(canonicalInput);
      const xmi2 = exportXmi(canonicalInput);
      const exportDeterministic = xmi1 === xmi2;

      const reimported = importXmi(xmi1);
      const reimportMatches = reimported.outcome === "success" && deepEqual(reimported.canonicalModel, expectedReimport);
      const validation = reimported.canonicalModel ? validate(reimported.canonicalModel) : null;
      const validatorOk = validation !== null && validation.valid === true && validation.errors.length === 0;

      // El XMI esperado del fixture reimporta al mismo canónico (equivalencia semántica).
      let fixtureXmiEquivalent = null;
      if (files.has("expected-xmi-export.xmi")) {
        const expectedXmi = fs.readFileSync(path.join(dir, "expected-xmi-export.xmi"), "utf-8");
        const fromFixture = importXmi(expectedXmi);
        fixtureXmiEquivalent = fromFixture.outcome === "success" && deepEqual(fromFixture.canonicalModel, expectedReimport);
      }

      const ok = check(
        exportDeterministic && reimportMatches && validatorOk && fixtureXmiEquivalent !== false,
        `fixture ${name}: exportación/round-trip`,
      );
      corpus.push({
        fixture: name,
        kind: "round-trip",
        path: rel,
        exportDeterministic,
        reimportMatches,
        validatorErrors: validation ? validation.errors.length : null,
        fixtureXmiEquivalent,
        canonicalSha256: reimported.canonicalModel ? modelSha256(reimported.canonicalModel) : null,
        ok,
      });
      console.log(`[acceptance] ${name}: deterministic=${exportDeterministic} reimport=${reimportMatches}`);
    }
  }

  check(corpus.length >= 6, `corpus incompleto: ${corpus.length} fixtures (se esperaban al menos 6)`);

  /* -------------------------------------------------------------- */
  /* Etapa B: convergencia de dos clientes sobre el fixture importado */
  /* -------------------------------------------------------------- */

  const collaboration = { seedFixture: "fixtures/xmi/02-associations/input.xmi" };
  const seed = importedModels.get("02-associations");

  if (!seed) {
    check(false, "colaboración: no se pudo importar el fixture semilla 02-associations");
    collaboration.converged = false;
  } else {
    collaboration.seedModelId = seed.id;
    collaboration.seedSha256 = modelSha256(seed);

    const hub = new LocalCollaborationHub(cloneModel(seed), { sessionId: "sess-p9-003", initialSeqNumber: 0 });
    const a = hub.createClient("client-A", { initialModel: cloneModel(seed), initialSeqNumber: 0 });
    const b = hub.createClient("client-B", { initialModel: cloneModel(seed), initialSeqNumber: 0 });
    hub.connect("client-A");
    hub.connect("client-B");

    const converged = () => {
      const sha = modelSha256(hub.coordinator.currentModel);
      return (
        a.state === "IN_SYNC" &&
        b.state === "IN_SYNC" &&
        a.localSeqNumber === hub.coordinator.currentSeqNumber &&
        b.localSeqNumber === hub.coordinator.currentSeqNumber &&
        modelSha256(a.localModel) === sha &&
        modelSha256(b.localModel) === sha &&
        a.localModel.version === b.localModel.version
      );
    };

    // Traza §9.1: comandos secuenciales de A y B sobre el modelo del fixture.
    a.submitCommand(a.buildCommand("CreateClass", { id: "CLS_20", name: "Factura", packageId: "PKG_02", isAbstract: false }));
    b.submitCommand(
      b.buildCommand("AddAttribute", {
        id: "ATTR_20",
        classId: "CLS_10",
        name: "telefono",
        type: "String",
        nullable: true,
        multiplicity: "0..1",
      }),
    );
    const sequential = { converged: converged(), seqNumber: hub.coordinator.currentSeqNumber };
    check(sequential.converged, "colaboración §9.1: convergencia tras comandos secuenciales");

    // Traza §9.2: emisión simultánea sobre la misma versión; el segundo comando
    // se rechaza con CONCURRENT_MODIFICATION sin mutar el modelo ni consumir seq.
    const cmdA = a.buildCommand("DeleteClass", { classId: "CLS_12" });
    const cmdB = b.buildCommand("AddAttribute", {
      id: "ATTR_21",
      classId: "CLS_12",
      name: "sku",
      type: "String",
      nullable: false,
      multiplicity: "1",
    });
    a.submitCommand(cmdA);
    const seqBeforeReject = hub.coordinator.currentSeqNumber;
    b.submitCommand(cmdB);
    const rejectionCodes = b.rejections.flatMap((r) => r.errors.map((e) => e.code));
    const concurrent = {
      rejectionCode: rejectionCodes.includes("CONCURRENT_MODIFICATION") ? "CONCURRENT_MODIFICATION" : rejectionCodes[0] ?? null,
      seqUnchangedAfterReject: hub.coordinator.currentSeqNumber === seqBeforeReject,
      converged: converged(),
      seqNumber: hub.coordinator.currentSeqNumber,
    };
    check(
      concurrent.rejectionCode === "CONCURRENT_MODIFICATION" && concurrent.seqUnchangedAfterReject && concurrent.converged,
      "colaboración §9.2: rechazo concurrente determinista y convergencia",
    );

    // Traza §9.3: corte transitorio de B; A avanza; B reconecta con catch-up.
    hub.disconnect("client-B");
    const bSeqDuringCut = b.localSeqNumber;
    a.submitCommand(
      a.buildCommand("AddAttribute", {
        id: "ATTR_22",
        classId: "CLS_11",
        name: "estado",
        type: "String",
        nullable: false,
        multiplicity: "1",
      }),
    );
    a.submitCommand(a.buildCommand("CreateClass", { id: "CLS_21", name: "Envio", packageId: "PKG_02" }));
    const missed = hub.coordinator.currentSeqNumber - bSeqDuringCut;
    hub.connect("client-B");
    b.acknowledge();
    const reconnection = {
      mode: "catch-up",
      missedSeqNumbers: missed,
      bSeqDuringCut,
      converged: converged(),
      seqNumber: hub.coordinator.currentSeqNumber,
    };
    check(missed === 2 && reconnection.converged, "colaboración §9.3: reconexión con catch-up y convergencia");

    // Traza §9.5: respuesta perdida; el reintento con el mismo clientCommandId
    // no duplica la mutación (deduplicación §5.1).
    hub.dropNextMessageFor("client-A");
    const retryCommand = a.buildCommand("CreateClass", { id: "CLS_22", name: "Orden", packageId: "PKG_02" });
    a.submitCommand(retryCommand);
    const seqAfterLostAck = hub.coordinator.currentSeqNumber;
    a.submitCommand(retryCommand);
    const ordenCount = hub.coordinator.currentModel.classes.filter((c) => c.name === "Orden").length;
    const idempotentRetry = {
      seqStableAfterRetry: hub.coordinator.currentSeqNumber === seqAfterLostAck,
      singleEffect: ordenCount === 1,
      converged: converged(),
    };
    check(idempotentRetry.seqStableAfterRetry && idempotentRetry.singleEffect, "colaboración §9.5: reintento idempotente");

    // Sin duplicados: todos los ids de elementos del modelo final son únicos.
    const finalModel = hub.coordinator.currentModel;
    const elementIds = [
      ...finalModel.packages.map((p) => p.id),
      ...finalModel.classes.map((c) => c.id),
      ...finalModel.classes.flatMap((c) => c.attributes.map((attr) => attr.id)),
      ...finalModel.associations.map((assoc) => assoc.id),
    ];
    const uniqueIds = new Set(elementIds);
    const duplicatesDetected = uniqueIds.size !== elementIds.length;

    const shaCoordinator = modelSha256(finalModel);
    const shaA = modelSha256(a.localModel);
    const shaB = modelSha256(b.localModel);
    const equivalent = shaA === shaCoordinator && shaB === shaCoordinator;

    check(!duplicatesDetected, "colaboración: ids duplicados en el modelo final");
    check(equivalent, "colaboración: modelos finales no equivalentes (SHA-256)");

    collaboration.concurrentTrace = concurrent;
    collaboration.sequentialTrace = sequential;
    collaboration.reconnection = reconnection;
    collaboration.idempotentRetry = idempotentRetry;
    collaboration.final = {
      seqNumber: hub.coordinator.currentSeqNumber,
      modelVersion: finalModel.version,
      sha256A: shaA,
      sha256B: shaB,
      sha256Coordinator: shaCoordinator,
      equivalent,
      clientStates: { a: a.state, b: b.state },
    };
    collaboration.duplicates = {
      duplicatesDetected,
      elementIds: elementIds.length,
      uniqueElementIds: uniqueIds.size,
    };
    collaboration.converged = equivalent && !duplicatesDetected;
    console.log(
      `[acceptance] colaboración: seq=${collaboration.final.seqNumber} version=${finalModel.version} ` +
        `sha=${shaCoordinator.slice(0, 12)}… equivalent=${equivalent} duplicates=${duplicatesDetected}`,
    );
  }

  /* -------------------------------------------------------------- */
  /* Evidencia                                                      */
  /* -------------------------------------------------------------- */

  const verdict = failures.length === 0 ? "pass" : "fail";
  const evidence = {
    verdict,
    generatedAt: new Date().toISOString(),
    contracts: ["docs/contracts/xmi-profile-v1.md", "docs/contracts/collaboration-protocol-v1.md"],
    xmi: { corpusDir: "fixtures/xmi", corpus },
    collaboration,
    failures,
  };

  fs.mkdirSync(path.dirname(args.evidence), { recursive: true });
  fs.writeFileSync(args.evidence, `${JSON.stringify(evidence, null, 2)}\n`, "utf-8");
  console.log(`[acceptance] evidencia: ${path.relative(repoRoot, args.evidence)}`);
  console.log(`[acceptance] verdict=${verdict}${failures.length > 0 ? ` fallos=[${failures.join("; ")}]` : ""}`);

  process.exitCode = verdict === "pass" ? 0 : 1;
}

main().catch((error) => {
  console.error(`[acceptance] FAIL: ${error.message}`);
  process.exitCode = 1;
});
