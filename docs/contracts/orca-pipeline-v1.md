# Contrato del pipeline Orca v1

## Entrada

`orca.ps1` recibe un comando y, cuando corresponde, un ID estable de tarea. Lee `AGENTS.md` y busca exactamente un YAML bajo `tasks/ready`, `tasks/active`, `tasks/backlog` o `tasks/done`. Expone `preflight`, `run`, `adopt`, `status`, `logs`, `resume`, `stop` y `dry-run`.

## Estados

`ready → preparing → executing → validating → reviewing → correcting → approved → committing → merging → done`

Después de una corrección se repiten validación y revisión. El contador máximo es dos. Cada transición válida se escribe atómicamente en `.orca/runs/<TASK-ID>/state.json` y se agrega como evento JSON Lines al log de la ejecución.

`review_failed` y `paused-agent-error` son estados operativos recuperables, fuera del camino primario. Conservan el estado y permiten que `resume` vuelva a `reviewing`; nunca equivalen a una ejecución inexistente.

Una tarea existente en `tasks/ready`, `tasks/active` o `tasks/done` sin `state.json` se informa como `state: "unmanaged"` y `adoptable: true`. `unmanaged` describe la ausencia de estado persistido; no es una transición de la máquina de estados.

## Adopción de tareas heredadas

`orca.ps1 adopt <TASK-ID> -Autonomous` incorpora una tarea heredada sin repetir su implementación inicial. Antes de persistir estado:

- rechaza tareas que ya tengan estado administrado;
- verifica que el YAML exista en `ready`, `active` o `done`;
- obtiene mediante Git y Orca la rama y el worktree actuales;
- exige que coincidan con los metadatos `orca.branch` y `orca.worktree` declarados, o con el ID de tarea cuando el metadato heredado no exista;
- reutiliza ese worktree y conserva sus cambios; nunca crea otro;
- registra `task-adopted` y comienza en `validating`.

La adopción siempre vuelve a ejecutar `validation_commands`, la comprobación de scope y una revisión independiente nueva. La evidencia o aprobación textual previa no concede una transición. Si se solicitan cambios, el escritor recibe únicamente el prompt de corrección; no se repite el prompt de implementación inicial. Tras una nueva aprobación continúa por `approved → committing → merging → done`.

## Respuesta del revisor

El prompt exige un único objeto JSON, sin texto adicional, con `verdict` igual a `approved` o `changes_requested`, `summary` de texto y `findings` con `severity`, `file`, `description` y `recommendation`. Las severidades canónicas son `blocking`, `high`, `medium` y `low`.

El adaptador acepta el objeto puro, rodeado por espacios, dentro de un bloque Markdown `json` o acompañado por texto incidental cuando existe exactamente un objeto válido. También extrae la respuesta final de los streams JSON de los agentes. Normaliza variantes previsibles en español, como `APROBADO` y `REQUIERE CORRECCIONES`, antes de decidir una transición.

Cada intento persiste stdout y stderr originales, JSON normalizado y error de análisis en `.orca/runs/<TASK-ID>/reviews/results/`. Una respuesta inválida provoca exactamente un reintento con sesión nueva. Si ambos intentos son inválidos, la ejecución queda en `review_failed`; un error de proceso queda en `paused-agent-error`. `status` expone `lastError` y `logPath`.

Si el gate de integración no aprueba, no se crea ningún commit. Una reanudación posterior invalida la aprobación previa y vuelve por `validating → reviewing` antes de solicitar una nueva aprobación del integrador.

## Roles

- Especificación o ADR: Kiro como escritor.
- Implementación o pruebas: Devin como escritor.
- Documentación/gobierno: Codex como escritor.
- Revisión independiente: Antigravity.
- Integración: Codex.

`owner_role` puede confirmar un escritor conocido, pero no asignar dos escritores. Cada adaptador registra ejecutable resuelto, argumentos, salida, error, código de retorno, duración y sesión recuperable.

## Seguridad y recuperación

- Un lock exclusivo por worktree impide dos escritores.
- Revisor e integrador reciben una réplica Git desechable del estado actual; sus herramientas no operan sobre la rama del escritor.
- El adaptador Codex del integrador usa `--sandbox danger-full-access` únicamente dentro de esa réplica desechable, evitando depender del helper de sandbox de Windows sin ampliar acceso a la rama del escritor.
- `resume` continúa desde el último estado persistido y reutiliza la sesión cuando la CLI lo permite.
- `resume` sobre una tarea `unmanaged` se rechaza indicando el comando `adopt` requerido.
- `stop` solicita detención y conserva estado/logs; no elimina ramas ni worktrees.
- Las validaciones se ejecutan literalmente con `pwsh -NoProfile -Command` desde el worktree.
- Solo el pipeline mueve la tarea, crea el commit y realiza integración local.
- La integración solo admite fast-forward. Si `main` está checkout, exige ese worktree limpio y usa `merge --ff-only`; si no está checkout, la adopción avanza `refs/heads/main` atómicamente sin crear un worktree. Cualquier conflicto, divergencia o cambio concurrente detiene el flujo.

## Salida

Todos los comandos escriben un documento JSON en stdout. Los logs persistentes usan JSON Lines. `dry-run` incluye roles, catálogo de adaptadores, prompts renderizados, comandos, transiciones y acciones Git, con `mutationsPerformed: false`.
