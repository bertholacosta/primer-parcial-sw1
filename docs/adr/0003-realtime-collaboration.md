# ADR-0003: colaboración en tiempo real

- Estado: `proposed`
- Decisor: Product Owner

## Pregunta

¿Qué modelo de consistencia, transporte y persistencia sincronizarán comandos concurrentes?

## Evidencia requerida

- Invariantes de convergencia y resolución de conflictos.
- Comparación de alternativas, incluida operación offline y reconexión.
- Pruebas reproducibles de concurrencia sobre el protocolo canónico.

## No decisión

No se selecciona CRDT, OT, transporte ni servidor en Fase 0. `P6-002` depende del contrato `P6-001`.
