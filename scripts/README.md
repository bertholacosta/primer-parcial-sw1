# Scripts

Automatización reproducible para validar estructura, contratos, generación y pruebas. `scripts/orca/` implementa el pipeline multiagente invocado por `orca.ps1`; su estado de ejecución vive en `.orca/`.

Una tarea heredada que ya tenga rama y worktree pero todavía no posea estado se identifica con `pwsh -NoProfile -File .\orca.ps1 status <TASK-ID>` como `unmanaged`. Se incorpora con `pwsh -NoProfile -File .\orca.ps1 adopt <TASK-ID> -Autonomous`; el comando reutiliza el worktree actual y comienza en validación y revisión independiente.

## Circuito e2e determinista (P9-001)

`pwsh -File scripts/validate-e2e.ps1` ejecuta desde un checkout limpio las cinco etapas del objetivo verificable inicial: carga del modelo de ejemplo, validación `domain-model` v1, generación del proyecto Spring Boot (dos ejecuciones comparadas byte a byte entre sí y contra el fixture golden `fixtures/generated-projects/biblioteca`), compilación Maven y validación del `flutter-descriptor.json` (`scripts/validate-flutter-descriptor.mjs`). Requiere `node`, `npm` y `mvn` en PATH; la salida de trabajo vive en `fixtures/generated-projects/.work/e2e` (ignorada por git).
