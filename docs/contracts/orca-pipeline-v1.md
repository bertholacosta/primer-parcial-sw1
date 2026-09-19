# Contrato del pipeline Orca v1

## Entrada

`orca.ps1` recibe un comando y, cuando corresponde, un ID estable de tarea. Lee `AGENTS.md` y busca exactamente un YAML bajo `tasks/ready`, `tasks/active`, `tasks/backlog` o `tasks/done`. Expone `preflight`, `run`, `adopt`, `status`, `logs`, `resume`, `stop` y `dry-run`.

## Estados

`ready → preparing → executing → validating → reviewing → correcting → approved → committing → merging → done`

Después de una corrección se repiten validación y revisión. El contador máximo es dos y solo se consume cuando el escritor produjo cambios reales y posteriormente fallaron las validaciones funcionales o el revisor solicitó correcciones. Cada transición válida se escribe atómicamente en `.orca/runs/<TASK-ID>/state.json` y se agrega como evento JSON Lines al log de la ejecución.

`review_failed` y `paused-agent-error` son estados operativos recuperables, fuera del camino primario. Conservan el estado y permiten que `resume` continúe; nunca equivalen a una ejecución inexistente. `paused-agent-error` puede originarse en `executing`, `validating`, `reviewing` o `approved`; al reanudar, el pipeline vuelve al estado registrado en `pausedFrom` (`reviewing` si el dato no existe, como en las ejecuciones anteriores a esta regla).

Una tarea existente en `tasks/ready`, `tasks/active` o `tasks/done` sin `state.json` se informa como `state: "unmanaged"` y `adoptable: true`. `unmanaged` describe la ausencia de estado persistido; no es una transición de la máquina de estados.

## Adopción de tareas heredadas

`orca.ps1 adopt <TASK-ID> -Autonomous` incorpora una tarea heredada sin repetir su implementación inicial. Antes de persistir estado:

- rechaza tareas que ya tengan estado administrado;
- verifica que el YAML exista en `ready`, `active` o `done`;
- obtiene mediante Git y Orca la rama y el worktree actuales;
- exige que coincidan con los metadatos `orca.branch` y `orca.worktree` declarados, o con el ID de tarea cuando el metadato heredado no exista;
- reutiliza ese worktree y conserva sus cambios; nunca crea otro;
- evalúa la evidencia de implementación: entregables declarados que existen en el worktree o cambios reales de implementación (confirmados o sin confirmar, excluyendo `.orca/` y el movimiento `tasks/ready → tasks/active` del propio YAML de la tarea);
- si existe evidencia, comienza en `validating`; si no existe ningún entregable ni cambio real, comienza en `executing` con el prompt inicial del escritor;
- registra `task-adopted` con `startsAt` y la evidencia encontrada.

Nunca se envía un prompt de corrección antes de una ejecución inicial exitosa. Mover la tarea a `tasks/active` no cuenta como implementación del producto.

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

## Orden de argumentos por adaptador

Las invocaciones se construyen a partir de la ayuda instalada (`--help`, `--version`), nunca de flags inventados.

- Kiro: `kiro-cli chat <PROMPT> --no-interactive --agent-engine v3 --output-format stream-json --trust-all-tools`. Cuando se usa `--output-format stream-json`, el adaptador selecciona explícitamente `--agent-engine v3`; el engine `v1` no admite `stream-json`. La combinación engine/formato se valida antes de lanzar cualquier tarea real y el preflight ejecuta `kiro-cli chat <args> --help` como comprobación de parseo no destructiva contra la versión instalada.
- Devin: `devin --permission-mode accept-edits --respect-workspace-trust false --prompt-file <PROMPT_FILE> --export <SESSION_FILE> --print`. La CLI `devin 3000.x` exige todas las opciones antes de cualquier `[PATH]` posicional y antes del separador `--`; un PATH se interpreta como "abrir Devin Desktop" y rompe el parseo. El directorio de trabajo se fija mediante el proceso que lanza el CLI, no como PATH. El lanzador externo de Orca presentó este orden incorrecto (`'--permission-mode' is neither a known subcommand nor an existing path`); el adaptador interno construye su propia lista ordenada, la valida antes de lanzar y permanece independiente del lanzador externo. El preflight ejecuta `devin <args> --version` como comprobación de parseo no destructiva contra la versión instalada; no se limita a `Get-Command`.

## Clasificación de fallos

El pipeline separa explícitamente: fallos funcionales, fallos de validación, hallazgos del revisor y fallos de infraestructura. Las categorías de infraestructura son: errores de autenticación (`authentication`), cuota agotada (`quota-exhausted`), argumentos o flags inválidos (`invalid-arguments`), proceso que no pudo comenzar (`process-start-failed`), engine incompatible (`incompatible-engine`), formato de transporte inválido (`invalid-transport`) y otros fallos del entorno (`infrastructure`).

Los fallos de infraestructura no incrementan `correctionCount`. Cada uno conserva en `.orca/runs/<TASK-ID>/agent-failures/failure-*.json`: stdout, stderr, código de salida, argumentos efectivos, versión del CLI, categoría y ruta del log; además se agrega el evento `agent-failure-recorded` y la entrada queda en `state.agentFailures`. La tarea queda en el estado recuperable `paused-agent-error` con `pausedFrom` registrado.

Los ciclos de corrección solo se consumen cuando el escritor produjo cambios (entregables presentes o rutas de implementación modificadas, excluyendo `.orca/` y el movimiento del YAML de la tarea) y posteriormente fallaron validaciones funcionales o el revisor solicitó correcciones. Un fallo funcional del escritor sin cambios producidos también pausa la ejecución en `paused-agent-error`: no existe trabajo que corregir.

## Seguridad y recuperación

- Un lock exclusivo por worktree impide dos escritores.
- Revisor e integrador reciben una réplica Git desechable del estado actual; sus herramientas no operan sobre la rama del escritor.
- El adaptador Codex del integrador usa `--sandbox danger-full-access` únicamente dentro de esa réplica desechable, evitando depender del helper de sandbox de Windows sin ampliar acceso a la rama del escritor.
- `resume` continúa desde el último estado persistido y reutiliza la sesión cuando la CLI lo permite.
- `resume` tras corregir una causa de infraestructura: cuando todos los intentos anteriores corresponden exclusivamente a infraestructura (todo `agent-finished` con error clasifica como infraestructura, no hay `changes_requested` del revisor y no existe evidencia de implementación en el worktree), restablece `correctionCount` a cero, conserva historial y logs, limpia el halt de infraestructura, reutiliza la misma rama y worktree, vuelve a `executing` y ejecuta el prompt inicial correcto. No vuelve a adoptar, no repite trabajo completado ni crea otro worktree. Las correcciones funcionales legítimas nunca se restablecen.
- `resume` sobre una tarea `unmanaged` se rechaza indicando el comando `adopt` requerido.
- `stop` solicita detención y conserva estado/logs; no elimina ramas ni worktrees.
- Las validaciones se ejecutan literalmente con `pwsh -NoProfile -Command` desde el worktree.
- Solo el pipeline mueve la tarea, crea el commit y realiza integración local.
- La integración solo admite fast-forward. Si `main` está checkout, exige ese worktree limpio y usa `merge --ff-only`; si no está checkout, la adopción avanza `refs/heads/main` atómicamente sin crear un worktree. Cualquier conflicto, divergencia o cambio concurrente detiene el flujo.

## Salida

Todos los comandos escriben un documento JSON en stdout. Los logs persistentes usan JSON Lines. `dry-run` incluye roles, catálogo de adaptadores, prompts renderizados, comandos, transiciones y acciones Git, con `mutationsPerformed: false`.
