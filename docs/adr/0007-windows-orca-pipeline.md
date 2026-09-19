# ADR-0007: pipeline multiagente de Orca en Windows

- Estado: `accepted`
- Fecha: 2026-09-19
- Autoridad: Product Owner, mediante instrucción explícita de P0-002

## Contexto

El repositorio necesita ejecutar tareas completas sin copiar prompts, manteniendo trazabilidad, recuperación y límites de un escritor por worktree.

## Decisión

- Windows 11 y PowerShell 7 (`pwsh`) son el entorno canónico de agentes.
- `orca.ps1` es la entrada estable del pipeline.
- Orca administra worktrees y metadatos; adaptadores versionados ejecutan `codex`, `kiro-cli`, `devin` y `agy` según sus interfaces verificadas.
- El estado local, locks, logs y sesiones viven en `.orca/` y no se versionan.
- Los agentes de solo lectura trabajan sobre réplicas Git desechables para aislar la rama del escritor incluso si una CLI intenta escribir.
- Las transiciones y operaciones Git son deterministas; ningún agente decide por sí mismo integrar.
- Un dry-run no crea worktrees, sesiones, commits ni estado persistente.
- Las tareas heredadas sin estado pueden adoptarse desde su rama y worktree existentes. La adopción comienza en validación, exige revisión independiente nueva y no crea ni reemplaza worktrees.
- Cuando `main` no está checkout, una adopción puede completar el mismo fast-forward mediante actualización atómica de la referencia, sin materializar otro worktree.
- Las respuestas de revisión se normalizan a un contrato JSON estricto; cada intento conserva salida original, resultado normalizado y error. Una salida inválida solo admite un reintento con sesión nueva y deja un estado operativo recuperable si vuelve a fallar.

## Consecuencias

- `preflight` debe fallar si falta PowerShell 7, Git, Orca o un adaptador requerido.
- Las tareas deben declarar comandos ejecutables desde PowerShell 7.
- Las decisiones de producto, aceptación de ADR, acciones destructivas, conflictos, dos correcciones fallidas o requisitos contradictorios detienen el pipeline.
- Los cambios de la interfaz de una CLI requieren actualizar y probar su adaptador.
