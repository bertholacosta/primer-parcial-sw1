# Arquitectura de referencia

## Principios confirmados

Las decisiones fundacionales están registradas como aceptadas en `docs/adr/0000-foundational-decisions.md`:

- Monorepo.
- Modelo canónico versionado como fuente de verdad.
- Generación Spring Boot determinista mediante reglas y plantillas.
- Flutter consume `domain-model.json` y metadatos derivados.
- Android es la plataforma móvil prioritaria del parcial.
- Flujo de entrega: especificación, implementación, revisión, corrección e integración.
- Voz, imágenes, colaboración e IA local se abordan después de cerrar el circuito determinista básico.

## Flujo de datos

```text
Entradas UML/visuales/XMI/IA
             |
             v
   comandos propuestos y validados
             |
             v
  domain-model.json versionado
       |                  |
       v                  v
 validador          adaptadores XMI
       |
       v
 generador determinista
       |
       +--> Spring Boot: Entity / DTO / Repository / Service / Controller
       |
       +--> descriptor de runtime para Flutter
```

## Límites de módulos

- `packages/domain-model/`: contrato y utilidades puras del modelo canónico.
- `packages/domain-validator/`: validación determinista y diagnósticos estables.
- `services/generator-cli/`: orquestación de generación; no contiene decisiones interactivas ni IA.
- `templates/spring-boot/`: plantillas versionadas; sus salidas son regenerables y no se editan a mano.
- `services/model-server/`: API, metadatos y coordinación del modelo; tecnología pendiente.
- `apps/mobile-flutter/`: runtime dinámico y offline controlado por descriptor/modelo.
- `apps/case-web/`: edición visual; tecnología pendiente.
- `packages/xmi-adapter/`: frontera XMI/Enterprise Architect, aislada del modelo canónico.
- `packages/collaboration-protocol/`: comandos y protocolo de colaboración, sin elegir aún transporte.

## Invariantes

1. Toda representación externa se convierte al modelo canónico antes de generar.
2. Una entrada inválida no produce código parcial aceptable.
3. Mismo modelo, versión de generador, configuración y plantillas producen la misma salida observable.
4. El descriptor Flutter debe declarar su versión y trazabilidad al modelo de origen.
5. Las cinco capas Spring son obligatorias; sus responsabilidades no se fusionan.
6. PostgreSQL se accede mediante JPA/Hibernate en los proyectos generados.
7. Las propuestas de IA no mutan estado hasta superar validación determinista.

## Orquestación de agentes

El pipeline local se ejecuta en Windows 11 con PowerShell 7 mediante `orca.ps1`. Conserva estado y logs recuperables fuera de Git en `.orca/`, crea un worktree por tarea nueva, puede adoptar sin duplicación el worktree de una tarea heredada, impide escritores concurrentes y usa adaptadores explícitos para Codex, Kiro, Devin y Antigravity. Una adopción reinicia el control objetivo en validación y revisión independiente, no en implementación. Los agentes proponen o revisan; las transiciones, validaciones y operaciones Git permanecen deterministas. Véanse `docs/adr/0007-windows-orca-pipeline.md` y `docs/contracts/orca-pipeline-v1.md`.

## Decisiones pendientes

No se elige todavía una tecnología concreta para el frontend CASE, la colaboración en tiempo real ni la implementación/engine de plantillas del generador. Las propuestas están en:

- `docs/adr/0001-case-web-technology.md`
- `docs/adr/0002-generator-implementation.md`
- `docs/adr/0003-realtime-collaboration.md`
- `docs/adr/0004-mobile-state-and-storage.md`
- `docs/adr/0005-android-local-ai.md`
- `docs/adr/0006-domain-model-validation.md`

Estas propuestas requieren comparación, evidencia y aprobación del Product Owner antes de pasar a estado `accepted`.
