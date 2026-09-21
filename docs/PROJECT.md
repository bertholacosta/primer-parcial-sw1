# Proyecto: ecosistema CASE UML

## Propósito

Construir un ecosistema que transforme modelos de clases UML 2.5+ en software verificable mediante un modelo canónico versionado. El circuito central es:

`UML → modelo canónico validado → generador Spring Boot → API y metadatos → Flutter dinámico`

La IA puede interpretar entradas y proponer comandos, pero solo reglas deterministas y validables pueden modificar el modelo o generar código.

## Alcance del producto

- Herramienta CASE web para diagramas de clases.
- Modelo canónico versionado como fuente de verdad.
- Importación y exportación XMI compatible con Enterprise Architect.
- Colaboración en tiempo real.
- Entradas visuales, por voz y por imágenes.
- Generador determinista de Spring Boot con capas obligatorias Controller, Service, Repository, Entity y DTO.
- Persistencia PostgreSQL mediante JPA/Hibernate.
- Cliente Flutter dinámico gobernado por `domain-model.json`.
- Android como plataforma móvil principal, con operación offline, voz local e IA local.

## Objetivo verificable inicial

El primer corte funcional futuro debe demostrar, sin intervención manual sobre artefactos generados:

1. Cargar un `domain-model.json` de ejemplo.
2. Validarlo contra un contrato versionado.
3. Generar un proyecto Spring Boot de forma reproducible.
4. Compilar el proyecto generado.
5. Exponer o producir un descriptor consumible por Flutter.

La Fase 0 no implementa este circuito; define su gobierno, contratos pendientes y backlog.

## Autoridad y responsabilidades

- Product Owner: aprueba alcance y decisiones críticas.
- Orca: controla issues, ramas, worktrees y fases.
- Antigravity/Gemini: arquitecto integrador, revisor independiente y resolución de problemas complejos.
- Kiro: análisis y especificación.
- Devin CLI/SWE-2: implementación principal.
- Codex/GPT-5.6 Sol: documentación y tareas asignadas (reincorporado tras confirmación de reinicio de cuota semanal).
- CI, compiladores, linters, validadores y pruebas: autoridad objetiva sobre aceptación técnica.

### Decisiones explícitas del Product Owner
- **2026-09-21 (actualización):** Con el reinicio de la cuota semanal confirmado por el Product Owner, Codex se reincorpora al catálogo de agentes activos para documentación y tareas asignadas, manteniendo a Antigravity como integrador determinista y revisor independiente.

## Restricciones de gobierno

No se cambian requisitos ni arquitectura global por iniciativa de un agente. Cada unidad de trabajo debe cumplir el contrato de `tasks/TASK-TEMPLATE.yaml`. No se integra trabajo con validaciones requeridas fallidas.
