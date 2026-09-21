# Scripts

Automatización reproducible para validar estructura, contratos, generación y pruebas. `scripts/orca/` implementa el pipeline multiagente invocado por `orca.ps1`; su estado de ejecución vive en `.orca/`.

Una tarea heredada que ya tenga rama y worktree pero todavía no posea estado se identifica con `pwsh -NoProfile -File .\orca.ps1 status <TASK-ID>` como `unmanaged`. Se incorpora con `pwsh -NoProfile -File .\orca.ps1 adopt <TASK-ID> -Autonomous`; el comando reutiliza el worktree actual y comienza en validación y revisión independiente.

## Circuito e2e determinista (P9-001)

`pwsh -File scripts/validate-e2e.ps1` ejecuta desde un checkout limpio las cinco etapas del objetivo verificable inicial: carga del modelo de ejemplo, validación `domain-model` v1, generación del proyecto Spring Boot (dos ejecuciones comparadas byte a byte entre sí y contra el fixture golden `fixtures/generated-projects/biblioteca`), compilación Maven y validación del `flutter-descriptor.json` (`scripts/validate-flutter-descriptor.mjs`). Requiere `node`, `npm` y `mvn` en PATH; la salida de trabajo vive en `fixtures/generated-projects/.work/e2e` (ignorada por git).

## Aceptación móvil y offline (P9-002)

`pwsh -File scripts/validate-mobile-offline.ps1` reproduce sin intervención manual el escenario de `mobile-offline` v1 en `apps/mobile-flutter`: carga dinámica del descriptor, edición en la UI dinámica, reinicio sin red con la operación conservada y reintento idempotente sin duplicados. Ejecuta `test/mobile_offline_acceptance_test.dart` y valida la evidencia emitida en `build/mobile-offline-acceptance/evidence.json`. Requiere `flutter` en PATH; con `-WithDevice` (y `adb`) añade una etapa en dispositivo Android con modo avión y reinicio en frío.
