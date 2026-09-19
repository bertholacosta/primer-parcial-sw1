# Gestión versionada de tareas

Cada tarea es un YAML independiente basado en `TASK-TEMPLATE.yaml`. El archivo se promueve desde `backlog/` a `ready/` y luego se mueve entre `active/` y `done/`; no se duplica. Orca conserva la relación con issue, rama y worktree.

## Estados y flujo

1. `backlog`: trabajo planificado; puede contener comandos bloqueados por una decisión pendiente.
2. `ready`: alcance ejecutable, dependencias satisfechas y comandos exactos de validación.
3. `active`: asignada a un único escritor en una rama y worktree propios.
4. Revisión: un agente independiente inspecciona sin escribir en la rama.
5. Corrección: solo el escritor aplica cambios solicitados.
6. `done`: integrador verifica aceptación y evidencia; el Product Owner aprueba cuando corresponda.

Una tarea no puede ampliar sus `allowed_paths`: todo lo no listado está prohibido, además de `forbidden_paths`. Todo hallazgo fuera de alcance se registra como nueva tarea. Tras dos intentos fallidos de implementación se detiene el trabajo y vuelve a análisis.

## Convenciones

- ID: `P<fase>-<secuencia de tres dígitos>`; nunca se reutiliza.
- Rama sugerida: `task/<id-en-minusculas>-<slug>`.
- Un issue, una rama, un worktree y un escritor por tarea.
- El revisor no modifica la rama revisada.
- Los resultados de validación se registran en `evidence` antes de mover a `done`.
- No se hace push, merge remoto ni eliminación de ramas sin autorización.

El backlog inicial está en `backlog/`; solo `P1-001` está en `ready/` y corresponde a especificación por Kiro.
