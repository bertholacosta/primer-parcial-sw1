# Scripts

Automatización reproducible para validar estructura, contratos, generación y pruebas. `scripts/orca/` implementa el pipeline multiagente invocado por `orca.ps1`; su estado de ejecución vive en `.orca/`.

Una tarea heredada que ya tenga rama y worktree pero todavía no posea estado se identifica con `pwsh -NoProfile -File .\orca.ps1 status <TASK-ID>` como `unmanaged`. Se incorpora con `pwsh -NoProfile -File .\orca.ps1 adopt <TASK-ID> -Autonomous`; el comando reutiliza el worktree actual y comienza en validación y revisión independiente.
