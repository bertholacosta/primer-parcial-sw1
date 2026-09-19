# ADR-0000: decisiones fundacionales

- Estado: `accepted`
- Fecha: 2026-09-19
- Autoridad: Product Owner, mediante instrucción explícita de la Fase 0

## Contexto

El proyecto necesita una base estable antes de elegir implementaciones concretas.

## Decisiones

1. El repositorio será un monorepo.
2. El modelo canónico versionado será la fuente de verdad.
3. La generación Spring Boot será determinista y basada en reglas/plantillas.
4. Flutter consumirá `domain-model.json` y/o un descriptor trazable derivado de este.
5. Android será la plataforma móvil principal del parcial.
6. El desarrollo seguirá especificación, implementación, revisión, corrección e integración.
7. Voz, imágenes, colaboración e IA local se implementarán después de cerrar el circuito determinista básico.

## Consecuencias

- Los adaptadores externos nunca sustituyen al modelo canónico.
- La reproducibilidad es un criterio de aceptación del generador.
- Las elecciones aún abiertas requieren ADR separados.
- Las fases posteriores no deben bloquear el circuito mínimo inicial.
