# ADR-0009: Tipos de relación UML en el modelo canónico

- Estado: accepted (Product Owner, 2026-XX)
- Relacionado: ADR-0008, `docs/contracts/domain-model-v1.md`, `docs/contracts/model-commands-v1.md`

## Contexto

El editor debe comportarse como una herramienta CASE UML real y el modelo debe
ser lo bastante estricto para generar un backend Spring Boot correcto. Hasta
ahora solo existía la asociación simple con `navigability`.

## Decisión

`DomainAssociation` gana el campo opcional `kind` (por defecto `"association"`)
con valores `association | aggregation | composition | generalization |
dependency | associationClass`, y `associationClassId` opcional para enlazar la
clase portadora de atributos de una clase-asociación.

Semántica estricta por tipo:

- `generalization`: source = hija, target = padre. Sin multiplicidades ni
  navegabilidad (se almacenan como `"1"`/`"unidirectional"` por compatibilidad
  del esquema). Prohibidos ciclos y herencia múltiple (una hija, un solo padre).
- `dependency`: dirigida; mismas simplificaciones que generalización.
- `composition`: el target (parte) no puede ser parte de otra composición.
- `aggregation`: asociación con marcador de rombo hueco; sin restricciones extra.
- `associationClass`: exige `associationClassId` de una clase existente; la clase
  lleva los atributos del vínculo.

Generación Spring Boot:

- `generalization` → `@Inheritance(strategy = JOINED)` en la raíz y `extends`
  en la hija (sin `@Id` propio).
- `composition` → `cascade = ALL, orphanRemoval = true` en el lado del todo.
- `aggregation` → `cascade = {PERSIST, MERGE}`.
- `dependency` → no genera campo persistente.
- `associationClass` → la clase enlazada recibe `@ManyToOne` hacia ambos
  extremos; la asociación no genera campos en las clases de los extremos.

Editor: el popover de conexión ofrece el tipo; los marcadores siguen UML
(triángulo hueco, rombos, línea punteada).

## Consecuencias

- `kind` omitido equivale a `"association"`: modelos previos siguen válidos.
- `sourceMultiplicity`/`targetMultiplicity`/`navigability` permanecen
  obligatorios en el esquema; para `generalization`/`dependency` el protocolo
  rellena valores neutros y el generador los ignora.
- Las posiciones visuales siguen fuera del modelo canónico.
