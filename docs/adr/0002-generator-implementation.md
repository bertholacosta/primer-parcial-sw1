# ADR-0002: implementación del generador

- Estado: `proposed`
- Decisor: Product Owner

## Pregunta

¿Qué lenguaje, runtime y mecanismo de plantillas implementarán el generador determinista?

## Evidencia requerida

- Comparación de reproducibilidad, escape seguro, formateo, pruebas golden y distribución CLI.
- Prueba de orden estable y generación sin depender de red.
- Compatibilidad con el contrato definido por `P2-001`.

## No decisión

No se selecciona tecnología ni motor de plantillas en Fase 0. `P2-002` debe resolverlo antes de `P2-003`.
