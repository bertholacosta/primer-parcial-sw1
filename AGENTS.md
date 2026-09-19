# Guía operativa para agentes

Antes de trabajar, lee solo este archivo, la tarea YAML asignada y los documentos que esa tarea enlace. No explores el repositorio completo.

Entorno canónico: Windows 11 con PowerShell 7 (`pwsh`) para Orca, Codex, Kiro, Devin y Antigravity. Ejecuta las validaciones desde la raíz del repositorio; requieren `git`, `pwsh` y las herramientas específicas del módulo cuando sean incorporadas. No traduzcas los comandos a WSL ni a Windows PowerShell.

Fuentes de verdad, en orden: decisiones explícitas del Product Owner registradas en `docs/PROJECT.md`; ADR aceptados en `docs/adr/`; contratos versionados en `docs/contracts/`; tarea asignada; `docs/ARCHITECTURE.md`, `docs/ROADMAP.md` y `docs/REPO_MAP.md`. Una tarea no puede contradecir una fuente superior.

- Una tarea pequeña por rama y worktree de Orca; un solo agente escritor por rama.
- El revisor trabaja en modo lectura y nunca corrige la rama revisada.
- Respeta `allowed_paths` y `forbidden_paths`; no hagas refactorizaciones laterales.
- No cambies arquitectura sin ADR aceptado. No edites manualmente código generado.
- Ejecuta todos los comandos de validación declarados. CI, compiladores, linters y pruebas deciden la aceptación.
- Tras dos intentos fallidos, detén la implementación, documenta evidencia y devuelve la tarea a análisis.
- Conserva cambios del usuario. No hagas push, merge remoto ni elimines ramas sin autorización.
- Registra decisiones y estado en archivos versionados; no dependas de memoria conversacional.

Flujo: especificación (Kiro) → implementación (Devin CLI/SWE-2) → revisión independiente (Antigravity/Gemini 3.6) → corrección por el escritor → validación objetiva → integración por Codex/GPT-5.6 Sol con aprobación requerida.
