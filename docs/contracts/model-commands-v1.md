# Contrato de comandos del editor — `model-commands` v1

- **Versión del contrato:** 1.2.0
- **Estado:** accepted
- **Fecha:** 2026-09-23 (v1.2.0; original 2026-09-20)
- **Autoridad:** Product Owner (ADR-0000)
- **Depende de:** `docs/contracts/domain-model-v1.md` (contractVersion "1")

> **v1.2.0 (decisión del Product Owner):** el modelo canónico es el único
> paquete raíz. Se eliminan los comandos `CreatePackage`/`DeletePackage`, el
> campo `packageId` de `CreateClass`/`UpdateClass` y los errores de paquete.
> La unicidad de nombres de clase es global al documento.

---

## 1. Propósito y alcance

Este contrato define los comandos deterministas que el editor CASE (y cualquier adaptador externo autorizado) puede emitir para crear o modificar el modelo canónico. Cada comando tiene:

- Una **identidad** única (tipo + id de comando).
- **Precondiciones** que deben cumplirse antes de aplicarlo.
- Un **resultado** observable y verificable sobre el modelo.
- **Errores** concretos que se producen cuando una precondición falla; ningún error muta el modelo.

El contrato cubre el **corte mínimo** de la Fase 4: clases, atributos y asociaciones. No existen comandos de paquetes: el modelo es el único paquete raíz (ver `domain-model-v1.md` §3.2).

Este contrato no elige lenguaje de implementación, framework ni mecanismo de persistencia. Las invariantes de `docs/ARCHITECTURE.md` aplican íntegramente:

- Invariante 1: toda representación externa se convierte al modelo canónico antes de generar.
- Invariante 2: una entrada inválida no produce código parcial aceptable.
- Invariante 7: las propuestas de IA no mutan estado hasta superar validación determinista.

---

## 2. Convenciones generales

### 2.1 Estructura de un comando

Todo comando sigue este esquema:

```
CommandType {
  commandId   : string        // UUID v4 generado por el emisor; único por ejecución
  modelId     : string        // id del modelo sobre el que opera
  modelVersion: string        // versión esperada del modelo (optimistic concurrency)
  payload     : object        // datos específicos del comando (ver §3–§6)
}
```

- `commandId`: el receptor lo registra para idempotencia; reenviar el mismo `commandId` con idéntico `payload` es una operación sin efecto.
- `modelVersion`: si el modelo en memoria tiene una versión distinta a la declarada, el comando se rechaza con `CONCURRENT_MODIFICATION`. Esto garantiza consistencia en entornos colaborativos.

### 2.2 Resultado de un comando

Un comando produce exactamente uno de los siguientes resultados:

| Resultado | Significado |
|---|---|
| `accepted` | El comando fue aplicado; el modelo fue mutado; su campo `version` fue incrementado en `PATCH`. |
| `rejected` | Al menos una precondición falló; el modelo no fue mutado; se devuelven uno o más errores. |
| `noop` | El comando es idempotente y el estado ya era el deseado (solo para reenvíos por `commandId`). |

### 2.3 Invariante de no-mutación en error

Si cualquier precondición falla, el modelo **no se modifica en ningún campo**. Los errores se devuelven completos antes de cualquier escritura.

### 2.4 Identificadores

Los `id` de entidades (clases, atributos, asociaciones) son cadenas opacas generadas por el cliente. El contrato del modelo canónico (§2.2 de `domain-model-v1.md`) los acepta como UUID v4 o slugs únicos. El validador de comandos no impone formato adicional más allá de:
- No vacío.
- Único dentro del documento para la entidad del tipo correspondiente.

### 2.5 Nomenclatura válida

Los campos `name` de clases y atributos deben satisfacer el patrón `[A-Za-z_][A-Za-z0-9_]*` (igual que en `domain-model-v1.md`).

---

## 3. Comandos de clase

### 3.1 `CreateClass`

Crea una nueva clase en el modelo.

#### Payload

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `id` | string | sí | Identificador de la nueva clase. |
| `name` | string | sí | Nombre de la clase. Patrón `[A-Za-z_][A-Za-z0-9_]*`. |
| `description` | string | no | Texto libre. |

#### Precondiciones

| # | Precondición | Error si falla |
|---|---|---|
| PC-CC-1 | El `modelId` existe en el repositorio. | `MODEL_NOT_FOUND` |
| PC-CC-2 | La `modelVersion` coincide con la versión actual del modelo. | `CONCURRENT_MODIFICATION` |
| PC-CC-3 | No existe otra clase con el mismo `id` en el documento. | `DUPLICATE_ID` |
| PC-CC-4 | No existe otra clase con el mismo `name` en el documento (ámbito raíz único). | `DUPLICATE_CLASS_NAME` |
| PC-CC-5 | `name` satisface el patrón `[A-Za-z_][A-Za-z0-9_]*`. | `INVALID_NAME_FORMAT` |

#### Resultado: `accepted`

- Se añade la nueva clase al array `classes` del modelo.
- `attributes` de la nueva clase es `[]`.
- La versión `PATCH` del modelo se incrementa.

#### Ejemplo antes / después

**Antes:**
```json
{
  "contractVersion": "1",
  "id": "model-01",
  "name": "Tienda",
  "version": "1.0.0",
  "classes": [],
  "associations": []
}
```

**Comando:**
```json
{
  "type": "CreateClass",
  "commandId": "cmd-001",
  "modelId": "model-01",
  "modelVersion": "1.0.0",
  "payload": {
    "id": "cls-01",
    "name": "Producto"
  }
}
```

**Después (`accepted`):**
```json
{
  "contractVersion": "1",
  "id": "model-01",
  "name": "Tienda",
  "version": "1.0.1",
  "classes": [
    {
      "id": "cls-01",
      "name": "Producto",
      "attributes": []
    }
  ],
  "associations": []
}
```

---

### 3.2 `RenameClass`

Cambia el `name` de una clase existente.

#### Payload

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `classId` | string | sí | Id de la clase a renombrar. |
| `newName` | string | sí | Nuevo nombre. Patrón `[A-Za-z_][A-Za-z0-9_]*`. |

#### Precondiciones

| # | Precondición | Error si falla |
|---|---|---|
| PC-RC-1 | El `modelId` existe. | `MODEL_NOT_FOUND` |
| PC-RC-2 | La `modelVersion` coincide. | `CONCURRENT_MODIFICATION` |
| PC-RC-3 | Existe una clase con `classId` en el documento. | `CLASS_NOT_FOUND` |
| PC-RC-4 | No existe otra clase con `newName` en el documento. | `DUPLICATE_CLASS_NAME` |
| PC-RC-5 | `newName` satisface el patrón `[A-Za-z_][A-Za-z0-9_]*`. | `INVALID_NAME_FORMAT` |

#### Resultado: `accepted`

- El campo `name` de la clase identificada por `classId` se reemplaza por `newName`.
- El `id` de la clase no cambia.
- Las asociaciones que referencian esta clase por `id` no necesitan actualización.
- La versión `PATCH` del modelo se incrementa.

#### Ejemplo antes / después

**Antes:** clase `cls-01` con `name: "Producto"`.

**Comando:**
```json
{
  "type": "RenameClass",
  "commandId": "cmd-002",
  "modelId": "model-01",
  "modelVersion": "1.0.1",
  "payload": { "classId": "cls-01", "newName": "Articulo" }
}
```

**Después (`accepted`):** clase `cls-01` con `name: "Articulo"`, versión `1.0.2`.

**Error (`rejected`) — clase no existe:**
```json
{
  "result": "rejected",
  "errors": [{
    "code": "CLASS_NOT_FOUND",
    "path": "$.payload.classId",
    "message": "No existe una clase con id 'cls-99' en el modelo 'model-01'.",
    "severity": "ERROR"
  }]
}
```

---

### 3.3 `UpdateClass`

Modifica de forma atómica las propiedades editables de una clase sin cambiar su identidad.

#### Payload

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `classId` | string | sí | Id de la clase a modificar. |
| `name` | string | no | Nuevo nombre canónico. |
| `description` | string | no | Nueva descripción. |

Los valores resultantes deben conservar la unicidad de nombre en el documento. Los campos ausentes no cambian; un payload sin cambios produce `noop`.

---

### 3.4 `DeleteClass`

Elimina una clase y todos sus atributos. Las asociaciones que la referencian también se eliminan.

#### Payload

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `classId` | string | sí | Id de la clase a eliminar. |

#### Precondiciones

| # | Precondición | Error si falla |
|---|---|---|
| PC-DC-1 | El `modelId` existe. | `MODEL_NOT_FOUND` |
| PC-DC-2 | La `modelVersion` coincide. | `CONCURRENT_MODIFICATION` |
| PC-DC-3 | Existe una clase con `classId`. | `CLASS_NOT_FOUND` |

#### Resultado: `accepted`

- La clase con `classId` y todos sus `attributes` son eliminados del modelo.
- Toda asociación cuyo `sourceClassId` o `targetClassId` sea `classId` también es eliminada (eliminación en cascada de asociaciones).
- La versión `PATCH` del modelo se incrementa.

> **Nota:** la eliminación en cascada de asociaciones es parte del resultado, no un error. El editor debe informar al usuario cuántas asociaciones fueron eliminadas como efecto secundario.

---

## 4. Comandos de atributo

### 4.1 `AddAttribute`

Añade un atributo a una clase existente.

#### Payload

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `id` | string | sí | Identificador del nuevo atributo. |
| `classId` | string | sí | Id de la clase receptora. |
| `name` | string | sí | Nombre del atributo. Patrón `[A-Za-z_][A-Za-z0-9_]*`. |
| `type` | string | sí | Uno de los tipos del §3.5 de `domain-model-v1.md`. |
| `nullable` | boolean | sí | `true` si el atributo admite nulo. |
| `multiplicity` | string | sí | Uno de: `"1"`, `"0..1"`, `"1..*"`, `"0..*"`. |
| `description` | string | no | Texto libre. |

#### Precondiciones

| # | Precondición | Error si falla |
|---|---|---|
| PC-AA-1 | El `modelId` existe. | `MODEL_NOT_FOUND` |
| PC-AA-2 | La `modelVersion` coincide. | `CONCURRENT_MODIFICATION` |
| PC-AA-3 | Existe una clase con `classId`. | `CLASS_NOT_FOUND` |
| PC-AA-4 | No existe otro atributo con el mismo `id` en el documento. | `DUPLICATE_ID` |
| PC-AA-5 | No existe otro atributo con el mismo `name` dentro de la misma clase. | `DUPLICATE_ATTRIBUTE_NAME` |
| PC-AA-6 | `name` satisface el patrón `[A-Za-z_][A-Za-z0-9_]*`. | `INVALID_NAME_FORMAT` |
| PC-AA-7 | `type` es uno de los literales permitidos en `domain-model-v1.md` §3.5. | `UNKNOWN_TYPE` |
| PC-AA-8 | `multiplicity` es uno de los literales permitidos en `domain-model-v1.md` §3.6. | `INVALID_MULTIPLICITY` |

#### Advertencias (no bloquean la aceptación)

| Condición | Advertencia |
|---|---|
| `multiplicity` = `"1"` y `nullable` = `true` | `NULLABLE_REQUIRED_CONFLICT` |
| `multiplicity` = `"0..1"` y `nullable` = `false` | `NOT_NULLABLE_OPTIONAL_CONFLICT` |

#### Resultado: `accepted`

- El atributo se añade al array `attributes` de la clase `classId`.
- La versión `PATCH` del modelo se incrementa.
- Las advertencias se incluyen en la respuesta pero no impiden la aceptación.

#### Ejemplo antes / después

**Antes:** clase `cls-01` (`Producto`) con `attributes: []`.

**Comando:**
```json
{
  "type": "AddAttribute",
  "commandId": "cmd-003",
  "modelId": "model-01",
  "modelVersion": "1.0.2",
  "payload": {
    "id": "attr-01",
    "classId": "cls-01",
    "name": "nombre",
    "type": "String",
    "nullable": false,
    "multiplicity": "1"
  }
}
```

**Después (`accepted`):** clase `cls-01` con:
```json
"attributes": [
  { "id": "attr-01", "name": "nombre", "type": "String", "nullable": false, "multiplicity": "1" }
]
```
Versión del modelo: `1.0.3`.

**Error (`rejected`) — tipo desconocido:**
```json
{
  "result": "rejected",
  "errors": [{
    "code": "UNKNOWN_TYPE",
    "path": "$.payload.type",
    "message": "Tipo 'BigDecimal' no reconocido en el corte mínimo v1. Tipos permitidos: String, Integer, Long, Double, Boolean, Date, DateTime, UUID.",
    "severity": "ERROR"
  }]
}
```

---

### 4.2 `UpdateAttribute`

Modifica uno o más campos de un atributo existente.

#### Payload

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `attributeId` | string | sí | Id del atributo a modificar. |
| `classId` | string | sí | Id de la clase propietaria del atributo. |
| `name` | string | no | Nuevo nombre. Patrón `[A-Za-z_][A-Za-z0-9_]*`. |
| `type` | string | no | Nuevo tipo (debe ser un tipo permitido). |
| `nullable` | boolean | no | Nuevo valor de nullable. |
| `multiplicity` | string | no | Nueva multiplicidad. |
| `description` | string | no | Nuevo texto libre. |

Al menos uno de los campos opcionales debe estar presente; si el payload no contiene ningún campo modificable, el resultado es `noop`.

#### Precondiciones

| # | Precondición | Error si falla |
|---|---|---|
| PC-UA-1 | El `modelId` existe. | `MODEL_NOT_FOUND` |
| PC-UA-2 | La `modelVersion` coincide. | `CONCURRENT_MODIFICATION` |
| PC-UA-3 | Existe una clase con `classId`. | `CLASS_NOT_FOUND` |
| PC-UA-4 | Existe un atributo con `attributeId` dentro de la clase `classId`. | `ATTRIBUTE_NOT_FOUND` |
| PC-UA-5 | Si `name` está presente: no existe otro atributo con ese `name` en la misma clase. | `DUPLICATE_ATTRIBUTE_NAME` |
| PC-UA-6 | Si `name` está presente: satisface el patrón `[A-Za-z_][A-Za-z0-9_]*`. | `INVALID_NAME_FORMAT` |
| PC-UA-7 | Si `type` está presente: es un literal permitido del §3.5 de `domain-model-v1.md`. | `UNKNOWN_TYPE` |
| PC-UA-8 | Si `multiplicity` está presente: es un literal permitido del §3.6 de `domain-model-v1.md`. | `INVALID_MULTIPLICITY` |

#### Advertencias (no bloquean la aceptación)

Igual que en `AddAttribute`: `NULLABLE_REQUIRED_CONFLICT` y `NOT_NULLABLE_OPTIONAL_CONFLICT` se emiten cuando el estado resultante (tras aplicar los cambios) presenta el conflicto.

#### Resultado: `accepted`

- Los campos presentes en el payload reemplazan los valores actuales del atributo.
- Los campos ausentes permanecen sin cambio.
- La versión `PATCH` del modelo se incrementa.

#### Ejemplo antes / después

**Antes:** atributo `attr-01` con `type: "String"`, `nullable: false`.

**Comando:**
```json
{
  "type": "UpdateAttribute",
  "commandId": "cmd-004",
  "modelId": "model-01",
  "modelVersion": "1.0.3",
  "payload": {
    "attributeId": "attr-01",
    "classId": "cls-01",
    "type": "Integer",
    "nullable": true,
    "multiplicity": "0..1"
  }
}
```

**Después (`accepted`):** atributo `attr-01` con `type: "Integer"`, `nullable: true`, `multiplicity: "0..1"`. Versión del modelo: `1.0.4`.

Advertencia incluida en la respuesta:
```json
{
  "result": "accepted",
  "warnings": [{
    "code": "NOT_NULLABLE_OPTIONAL_CONFLICT",
    "path": "$.classes[?(@.id=='cls-01')].attributes[?(@.id=='attr-01')]",
    "message": "El atributo tiene multiplicity '0..1' pero nullable es false.",
    "severity": "WARNING"
  }]
}
```
*(En este ejemplo el cambio de `nullable` a `true` resuelve el conflicto; el ejemplo ilustra la estructura de advertencia en caso de que existiera.)*

---

### 4.3 `DeleteAttribute`

Elimina un atributo de una clase.

#### Payload

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `attributeId` | string | sí | Id del atributo a eliminar. |
| `classId` | string | sí | Id de la clase propietaria. |

#### Precondiciones

| # | Precondición | Error si falla |
|---|---|---|
| PC-DA-1 | El `modelId` existe. | `MODEL_NOT_FOUND` |
| PC-DA-2 | La `modelVersion` coincide. | `CONCURRENT_MODIFICATION` |
| PC-DA-3 | Existe una clase con `classId`. | `CLASS_NOT_FOUND` |
| PC-DA-4 | Existe un atributo con `attributeId` dentro de la clase `classId`. | `ATTRIBUTE_NOT_FOUND` |

#### Resultado: `accepted`

- El atributo con `attributeId` es eliminado del array `attributes` de la clase `classId`.
- La versión `PATCH` del modelo se incrementa.

---

## 5. Comandos de asociación

### 5.1 `CreateAssociation`

Crea una nueva asociación entre dos clases existentes.

#### Payload

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `id` | string | sí | Identificador de la nueva asociación. |
| `name` | string | no | Nombre legible de la relación. |
| `sourceClassId` | string | sí | Id de la clase origen. |
| `targetClassId` | string | sí | Id de la clase destino. |
| `sourceMultiplicity` | string | sí* | Multiplicidad en el extremo origen. *Obligatoria salvo `kind` `"generalization"`/`"dependency"` (se rellena `"1"`). |
| `targetMultiplicity` | string | sí* | Multiplicidad en el extremo destino. Misma regla. |
| `navigability` | string | sí* | `"unidirectional"` o `"bidirectional"`. *Solo kinds estructurales; para `generalization`/`dependency` se fuerza `"unidirectional"`. |
| `kind` | string | no | Tipo UML (ADR-0009): `"association"` (defecto), `"aggregation"`, `"composition"`, `"generalization"`, `"dependency"`, `"associationClass"`. |
| `associationClassId` | string | no | Obligatorio si `kind = "associationClass"`. |
| `description` | string | no | Texto libre. |

#### Precondiciones

| # | Precondición | Error si falla |
|---|---|---|
| PC-CA-1 | El `modelId` existe. | `MODEL_NOT_FOUND` |
| PC-CA-2 | La `modelVersion` coincide. | `CONCURRENT_MODIFICATION` |
| PC-CA-3 | No existe otra asociación con el mismo `id` en el documento. | `DUPLICATE_ID` |
| PC-CA-4 | Existe una clase con `sourceClassId`. | `CLASS_NOT_FOUND` |
| PC-CA-5 | Existe una clase con `targetClassId`. | `CLASS_NOT_FOUND` |
| PC-CA-6 | `sourceClassId` ≠ `targetClassId` (no se admiten auto-asociaciones en v1). | `SELF_ASSOCIATION_NOT_ALLOWED` |
| PC-CA-7 | `sourceMultiplicity` es uno de los literales permitidos (solo kinds estructurales). | `INVALID_MULTIPLICITY` |
| PC-CA-8 | `targetMultiplicity` es uno de los literales permitidos (solo kinds estructurales). | `INVALID_MULTIPLICITY` |
| PC-CA-9 | `navigability` es `"unidirectional"` o `"bidirectional"` (solo kinds estructurales). | `INVALID_NAVIGABILITY` |
| PC-CA-10 | `kind`, si presente, es uno de los valores permitidos. | `INVALID_ASSOCIATION_KIND` |
| PC-CA-11 | `kind = "generalization"`: la hija no tiene otra generalización. | `MULTIPLE_INHERITANCE` |
| PC-CA-12 | `kind = "generalization"`: no crea un ciclo de herencia. | `GENERALIZATION_CYCLE` |
| PC-CA-13 | `kind = "composition"`: el destino no es parte de otra composición. | `COMPOSITION_PART_OCCUPIED` |
| PC-CA-14 | `kind = "associationClass"`: `associationClassId` presente y existente. | `MISSING_ASSOCIATION_CLASS` / `ASSOCIATION_CLASS_NOT_FOUND` |

#### Resultado: `accepted`

- La asociación se añade al array `associations` del modelo.
- La versión `PATCH` del modelo se incrementa.

#### Ejemplo antes / después

**Antes:** modelo con clases `cls-01` (`Producto`) y `cls-02` (`Categoria`), `associations: []`.

**Comando:**
```json
{
  "type": "CreateAssociation",
  "commandId": "cmd-005",
  "modelId": "model-01",
  "modelVersion": "1.0.4",
  "payload": {
    "id": "assoc-01",
    "name": "perteneceA",
    "sourceClassId": "cls-01",
    "targetClassId": "cls-02",
    "sourceMultiplicity": "0..*",
    "targetMultiplicity": "1",
    "navigability": "unidirectional"
  }
}
```

**Después (`accepted`):**
```json
"associations": [
  {
    "id": "assoc-01",
    "name": "perteneceA",
    "sourceClassId": "cls-01",
    "targetClassId": "cls-02",
    "sourceMultiplicity": "0..*",
    "targetMultiplicity": "1",
    "navigability": "unidirectional"
  }
]
```
Versión del modelo: `1.0.5`.

**Error (`rejected`) — auto-asociación:**
```json
{
  "result": "rejected",
  "errors": [{
    "code": "SELF_ASSOCIATION_NOT_ALLOWED",
    "path": "$.payload.targetClassId",
    "message": "sourceClassId y targetClassId no pueden ser el mismo en v1. La clase 'cls-01' no puede asociarse consigo misma.",
    "severity": "ERROR"
  }]
}
```

---

### 5.2 `UpdateAssociation`

Modifica campos de una asociación existente.

#### Payload

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `associationId` | string | sí | Id de la asociación a modificar. |
| `name` | string | no | Nuevo nombre. |
| `sourceMultiplicity` | string | no | Nueva multiplicidad origen. |
| `targetMultiplicity` | string | no | Nueva multiplicidad destino. |
| `navigability` | string | no | Nuevo valor de navegabilidad. |
| `kind` | string | no | Nuevo tipo UML (`association`, `aggregation`, `composition`, `generalization`, `dependency`, `associationClass`). |
| `associationClassId` | string \| null | no | Clase portadora cuando el tipo resultante es `associationClass`; `null` elimina la referencia. |
| `description` | string | no | Nuevo texto libre. |

Al menos uno de los campos opcionales debe estar presente; si no hay campos, el resultado es `noop`.

> **Nota:** `sourceClassId` y `targetClassId` no son modificables mediante este comando; para cambiar los extremos de una asociación se debe eliminar y recrear (`DeleteAssociation` + `CreateAssociation`).

#### Precondiciones

| # | Precondición | Error si falla |
|---|---|---|
| PC-UAssoc-1 | El `modelId` existe. | `MODEL_NOT_FOUND` |
| PC-UAssoc-2 | La `modelVersion` coincide. | `CONCURRENT_MODIFICATION` |
| PC-UAssoc-3 | Existe una asociación con `associationId`. | `ASSOCIATION_NOT_FOUND` |
| PC-UAssoc-4 | Si `sourceMultiplicity` está presente: es un literal permitido. | `INVALID_MULTIPLICITY` |
| PC-UAssoc-5 | Si `targetMultiplicity` está presente: es un literal permitido. | `INVALID_MULTIPLICITY` |
| PC-UAssoc-6 | Si `navigability` está presente: es `"unidirectional"` o `"bidirectional"`. | `INVALID_NAVIGABILITY` |
| PC-UAssoc-7 | El tipo resultante es un tipo UML permitido y satisface sus invariantes. | `INVALID_ASSOCIATION_KIND`, `MULTIPLE_INHERITANCE`, `GENERALIZATION_CYCLE`, `COMPOSITION_PART_OCCUPIED` |
| PC-UAssoc-8 | Una clase-asociación resultante referencia una clase portadora existente. | `MISSING_ASSOCIATION_CLASS`, `ASSOCIATION_CLASS_NOT_FOUND` |

#### Resultado: `accepted`

- Los campos presentes en el payload reemplazan los valores actuales.
- Al cambiar a generalización o dependencia, multiplicidades y navegabilidad se normalizan a valores neutros.
- `associationClassId` solo se conserva para `kind: "associationClass"`.
- Los campos ausentes no cambian.
- La versión `PATCH` del modelo se incrementa.

---

### 5.3 `DeleteAssociation`

Elimina una asociación del modelo.

#### Payload

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `associationId` | string | sí | Id de la asociación a eliminar. |

#### Precondiciones

| # | Precondición | Error si falla |
|---|---|---|
| PC-DAssoc-1 | El `modelId` existe. | `MODEL_NOT_FOUND` |
| PC-DAssoc-2 | La `modelVersion` coincide. | `CONCURRENT_MODIFICATION` |
| PC-DAssoc-3 | Existe una asociación con `associationId`. | `ASSOCIATION_NOT_FOUND` |

#### Resultado: `accepted`

- La asociación con `associationId` es eliminada del array `associations`.
- La versión `PATCH` del modelo se incrementa.

---

## 6. Comandos de paquete — eliminados (v1.2.0)

No existen comandos de paquete. El modelo canónico es el único paquete raíz (`domain-model-v1.md` §3.2): todas las clases se crean y permanecen en ese ámbito. Los tipos `CreatePackage` y `DeletePackage` de versiones anteriores se rechazan con `UNKNOWN_COMMAND`.

## 7. Catálogo consolidado de errores

| Código | Severidad | Aplicable a | Descripción |
|---|---|---|---|
| `MODEL_NOT_FOUND` | ERROR | Todos | El `modelId` no existe en el repositorio. |
| `CONCURRENT_MODIFICATION` | ERROR | Todos | La `modelVersion` del comando no coincide con la versión actual del modelo. |
| `DUPLICATE_ID` | ERROR | CreateClass, AddAttribute, CreateAssociation | Ya existe una entidad con el mismo `id` en el documento. |
| `CLASS_NOT_FOUND` | ERROR | RenameClass, UpdateClass, DeleteClass, AddAttribute, UpdateAttribute, DeleteAttribute, CreateAssociation | No existe una clase con el `classId` o `sourceClassId`/`targetClassId` especificado. |
| `ATTRIBUTE_NOT_FOUND` | ERROR | UpdateAttribute, DeleteAttribute | No existe un atributo con el `attributeId` en la clase indicada. |
| `ASSOCIATION_NOT_FOUND` | ERROR | UpdateAssociation, DeleteAssociation | No existe una asociación con el `associationId`. |
| `DUPLICATE_CLASS_NAME` | ERROR | CreateClass, RenameClass, UpdateClass | Ya existe una clase con el mismo `name` en el documento. |
| `DUPLICATE_ATTRIBUTE_NAME` | ERROR | AddAttribute, UpdateAttribute | Ya existe un atributo con el mismo `name` en la misma clase. |
| `INVALID_NAME_FORMAT` | ERROR | CreateClass, RenameClass, AddAttribute, UpdateAttribute | El `name` no satisface `[A-Za-z_][A-Za-z0-9_]*`. |
| `UNKNOWN_TYPE` | ERROR | AddAttribute, UpdateAttribute | El `type` no es un literal permitido en `domain-model-v1.md` §3.5. |
| `INVALID_MULTIPLICITY` | ERROR | AddAttribute, UpdateAttribute, CreateAssociation, UpdateAssociation | El valor de `multiplicity`, `sourceMultiplicity` o `targetMultiplicity` no es un literal permitido. |
| `INVALID_NAVIGABILITY` | ERROR | CreateAssociation, UpdateAssociation | El valor de `navigability` no es `"unidirectional"` ni `"bidirectional"`. |
| `SELF_ASSOCIATION_NOT_ALLOWED` | ERROR | CreateAssociation | `sourceClassId` y `targetClassId` son iguales (auto-asociación no permitida en v1). |
| `NULLABLE_REQUIRED_CONFLICT` | WARNING | AddAttribute, UpdateAttribute | `multiplicity` es `"1"` y `nullable` es `true`. No bloqueante. |
| `NOT_NULLABLE_OPTIONAL_CONFLICT` | WARNING | AddAttribute, UpdateAttribute | `multiplicity` es `"0..1"` y `nullable` es `false`. No bloqueante. |

---

## 8. Estructura de la respuesta del procesador de comandos

```json
{
  "commandId": "string",
  "result": "accepted | rejected | noop",
  "modelVersion": "string (nueva versión si accepted, igual si rejected/noop)",
  "errors": [
    {
      "code": "string",
      "path": "string (JSONPath a la causa)",
      "message": "string (descripción legible)",
      "severity": "ERROR | WARNING"
    }
  ],
  "warnings": [
    {
      "code": "string",
      "path": "string",
      "message": "string",
      "severity": "WARNING"
    }
  ]
}
```

- `errors`: presente cuando `result` = `"rejected"`. Contiene al menos un elemento con `severity: "ERROR"`.
- `warnings`: puede estar presente en cualquier resultado; elementos con `severity: "WARNING"`.
- Si `result` = `"accepted"`, `errors` está vacío o ausente; `warnings` puede tener elementos.
- Si `result` = `"rejected"`, el modelo no fue mutado y `modelVersion` no cambia.

---

## 9. Secuencia de validación

El procesador de comandos debe evaluar las precondiciones en el siguiente orden para garantizar mensajes de error deterministas:

1. Existencia del modelo (`MODEL_NOT_FOUND`).
2. Concurrencia (`CONCURRENT_MODIFICATION`).
3. Existencia de entidades referenciadas (`CLASS_NOT_FOUND`, `ATTRIBUTE_NOT_FOUND`, `ASSOCIATION_NOT_FOUND`).
4. Unicidad de identidades (`DUPLICATE_ID`).
5. Unicidad de nombres (`DUPLICATE_CLASS_NAME`, `DUPLICATE_ATTRIBUTE_NAME`).
6. Formato de nombre (`INVALID_NAME_FORMAT`).
7. Valores enumerados (`UNKNOWN_TYPE`, `INVALID_MULTIPLICITY`, `INVALID_NAVIGABILITY`).
8. Restricciones estructurales (`SELF_ASSOCIATION_NOT_ALLOWED`).
9. Advertencias semánticas (`NULLABLE_REQUIRED_CONFLICT`, `NOT_NULLABLE_OPTIONAL_CONFLICT`) — solo si todos los pasos anteriores pasan.

Si el paso 1 falla, el procesador retorna inmediatamente sin evaluar los demás. El resto de pasos se evalúan completamente para devolver todos los errores en una sola respuesta.

---

## 10. Decisiones cerradas

| # | Decisión | Fundamento |
|---|---|---|
| D1 | Los errores nunca mutan el modelo. | Invariante 2 de `docs/ARCHITECTURE.md`. |
| D2 | Las propuestas de IA deben pasar por este contrato antes de mutar el modelo. | Invariante 7 de `docs/ARCHITECTURE.md`. |
| D3 | `DeleteClass` elimina en cascada sus asociaciones. | Consistencia referencial del modelo canónico. |
| D4 | No existen comandos de paquete: el modelo es el único paquete raíz y la unicidad de nombres de clase es global. | Decisión PO 2026-09-23 (v1.2.0). |
| D5 | Los extremos de una asociación (`sourceClassId`, `targetClassId`) no son modificables; se usa Delete + Create. | Simplifica la lógica de validación y el historial de cambios. |
| D6 | El control de concurrencia usa `modelVersion` (optimistic locking). | Soporte para entornos colaborativos sin bloqueos. |
| D7 | Auto-asociaciones no permitidas en el corte mínimo v1. | Coherente con `domain-model-v1.md` §3.7. |

---

## 11. Supuestos y preguntas abiertas

| # | Supuesto / Pregunta | Impacto si cambia |
|---|---|---|
| S1 | El versionado del modelo es semver `MAJOR.MINOR.PATCH`; los comandos solo incrementan `PATCH`. | Si se introducen cambios de ruptura, se necesita lógica de incremento `MAJOR`/`MINOR`. |
| S2 | El repositorio de modelos es una abstracción; este contrato no elige su implementación. | Sin impacto en el contrato; afecta solo a la implementación. |
| Q1 | ~~¿Se requiere un comando `MoveClass` (reasignar clase a otro paquete)?~~ **Resuelta (v1.2.0):** no hay paquetes; `MoveClass` no aplica. | — |
| Q2 | ¿El procesador de comandos es transaccional (batch de comandos atómico)? | Requeriría un comando `BatchCommands` y lógica de rollback; actualmente fuera del alcance v1. |
| Q3 | ¿Se registra un log de comandos aplicados para undo/redo? | Necesitaría un contrato de historial separado (`command-log-v1.md`). |
