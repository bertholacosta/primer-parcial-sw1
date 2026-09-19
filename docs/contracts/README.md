# Contratos del sistema

Esta carpeta contendrá contratos versionados entre módulos. Un contrato aceptado debe indicar versión, compatibilidad, invariantes, ejemplos válidos e inválidos y estrategia de migración.

## Contratos por definir

- `domain-model`: representación canónica de clases, atributos, asociaciones y metadatos mínimos.
- `validation-diagnostics`: códigos, rutas y severidad de errores estables.
- `generator-input-output`: entradas, configuración, manifiesto y reproducibilidad.
- `flutter-descriptor`: metadatos consumibles, compatibilidad y trazabilidad.
- `model-commands`: operaciones deterministas propuestas por UI, colaboración o IA.
- `xmi-profile`: subconjunto UML/XMI soportado y reglas Enterprise Architect.
- `collaboration-protocol`: orden, idempotencia, concurrencia y reconexión.
- `multimodal-proposals`: propuestas de voz/imagen/IA sin mutación directa.

## Circuito contractual mínimo

`fixtures/models/minimal-valid.domain-model.json` será validado por una versión explícita del contrato; la generación producirá un proyecto Spring Boot compilable y un descriptor versionado para Flutter. Los nombres finales y esquemas serán definidos por las tareas de especificación, no por este bootstrap.

No se considera contrato a una estructura inferida solo desde código. Los cambios incompatibles requieren nueva versión y ADR cuando afecten arquitectura.
