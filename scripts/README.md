# Scripts

Automatización reproducible para validar estructura, contratos, generación y pruebas. `scripts/orca/` implementa el pipeline multiagente invocado por `orca.ps1`; su estado de ejecución vive en `.orca/`.

Una tarea heredada que ya tenga rama y worktree pero todavía no posea estado se identifica con `pwsh -NoProfile -File .\orca.ps1 status <TASK-ID>` como `unmanaged`. Se incorpora con `pwsh -NoProfile -File .\orca.ps1 adopt <TASK-ID> -Autonomous`; el comando reutiliza el worktree actual y comienza en validación y revisión independiente.

## Matriz final del examen (P9-004)

`pwsh -NoProfile -File scripts/validate-exam-matrix.ps1` es el punto de entrada de la aceptación final. Requiere PowerShell 7, Git, Node.js, npm, Maven con Java y Flutter en `PATH`. Primero comprueba esas herramientas e imprime sus versiones efectivas; luego ejecuta, en orden y con fallo inmediato, las suites P9-001, P9-002 y P9-003 descritas abajo. La preparación del checkout, la demostración, las versiones verificadas y los riesgos residuales están en [`docs/EXAM_DELIVERY.md`](../docs/EXAM_DELIVERY.md).

## Circuito e2e determinista (P9-001)

`pwsh -File scripts/validate-e2e.ps1` ejecuta desde un checkout limpio las cinco etapas del objetivo verificable inicial: carga del modelo de ejemplo, validación `domain-model` v1, generación del proyecto Spring Boot (dos ejecuciones comparadas byte a byte entre sí y contra el fixture golden `fixtures/generated-projects/biblioteca`), compilación Maven y validación del `flutter-descriptor.json` (`scripts/validate-flutter-descriptor.mjs`). Requiere `node`, `npm` y `mvn` en PATH; la salida de trabajo vive en `fixtures/generated-projects/.work/e2e` (ignorada por git).

## Aceptación móvil y offline (P9-002)

`pwsh -File scripts/validate-mobile-offline.ps1` reproduce sin intervención manual el escenario de `mobile-offline` v1 en `apps/mobile-flutter`: carga dinámica del descriptor, edición en la UI dinámica, reinicio sin red con la operación conservada y reintento idempotente sin duplicados. Ejecuta `test/mobile_offline_acceptance_test.dart` y valida la evidencia emitida en `build/mobile-offline-acceptance/evidence.json`. Requiere `flutter` en PATH; con `-WithDevice` (y `adb`) añade una etapa en dispositivo Android con modo avión y reinicio en frío.

## Aceptación XMI y colaboración (P9-003)

`pwsh -File scripts/validate-xmi-collaboration.ps1` ejecuta desde un checkout limpio el round-trip XMI del corpus soportado y la convergencia de dos clientes sobre los fixtures versionados de `fixtures/xmi/` (contratos `xmi-profile-v1` y `collaboration-protocol-v1`). `scripts/xmi-collaboration-acceptance.mjs` importa cada `input.xmi` contra su `expected-canonical.json` (con validación `domain-model` v1 y reexportación sin pérdida semántica), verifica los `expected-error.json`, comprueba la exportación determinista canónico → XMI → canónico y reproduce la traza de dos clientes — comandos secuenciales, concurrencia con `CONCURRENT_MODIFICATION`, reconexión por catch-up y reintento idempotente — sembrada con el modelo importado de `02-associations`. El script valida la evidencia emitida en `.validation/xmi-collaboration/evidence.json` (ignorada por git): modelos finales equivalentes (mismo `seqNumber`, versión y SHA-256) y ausencia de duplicados. Requiere `node` y `npm` en PATH; con `-SkipInstall` reutiliza los `node_modules` ya instalados.
