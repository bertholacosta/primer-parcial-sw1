# Contrato del modelo canónico — `domain-model` v1

- **Versión del contrato:** 1.0.0
- **Estado:** accepted
- **Fecha:** 2026-09-19
- **Autoridad:** Product Owner (ADR-0000)
- **Archivo canónico:** `domain-model.json` (o cualquier fichero `.domain-model.json`)

---

## 1. Propósito y alcance

Este contrato define la representación tecnológica-neutral, versionada y verificable del modelo canónico en su corte mínimo clase/atributo/asociación. Es la única fuente de verdad que alimenta al validador, al generador Spring Boot y al descriptor Flutter. Ningún adaptador externo (XMI, voz, IA, imagen) sustituye a este modelo; toda entrada externa debe convertirse a él antes de cualquier generación o validación.

El contrato no elige lenguaje de implementación, framework, librería de validación ni motor de plantillas. Las implementaciones concretas se definen en contratos y ADR separados.

---

## 2. Versión e identidad estable

### 2.1 Campo de versión del contrato

Todo documento `domain-model.json` debe declarar la versión del contrato que satisface:

```
"contractVersion": "1"
```

El valor es una cadena de texto que identifica la versión mayor del contrato. Los consumidores deben rechazar documentos cuya `contractVersion` no coincida con la que soportan.

### 2.2 Identidad del modelo

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `contractVersion` | string | sí | Versión mayor del contrato. Valor fijo `"1"` para este contrato. |
| `id` | string | sí | Identificador estable del modelo. UUID v4 o slug único en el repositorio. No cambia al renombrar el modelo. |
| `name` | string | sí | Nombre legible del modelo. Puede cambiar sin afectar la identidad. |
| `version` | string | sí | Versión del documento de modelo, formato `MAJOR.MINOR.PATCH`. Incremental; los consumidores pueden usarla para detectar cambios. |
| `description` | string | no | Descripción libre. |

### 2.3 Política de campos desconocidos

- Un validador conforme **debe** ignorar y preservar campos no declarados en este contrato (política _ignore-unknown_).
- Un validador puede emitir una advertencia no bloqueante por cada campo desconocido de nivel superior.
- Los generadores **no deben** fallar por la presencia de campos adicionales; los ignoran.
- Esta política permite evolución compatible hacia adelante: versiones futuras del contrato añaden campos opcionales sin romper consumidores v1.

### 2.4 Evolución compatible

Una nueva versión del contrato es compatible con v1 si:

1. No elimina ningún campo obligatorio de v1.
2. No cambia la semántica de ningún campo existente de v1.
3. Solo añade campos opcionales con semántica nueva.

Un cambio incompatible requiere `contractVersion` `"2"` y un ADR aceptado.

---

## 3. Semántica y restricciones del modelo canónico

### 3.1 Estructura del documento

```
{
  "contractVersion": string,        // obligatorio
  "id": string,                     // obligatorio
  "name": string,                   // obligatorio
  "version": string,                // obligatorio
  "description": string,            // opcional
  "packages": [ Package ],          // obligatorio, ≥ 0 elementos
  "classes": [ Class ],             // obligatorio, ≥ 0 elementos
  "associations": [ Association ]   // obligatorio, ≥ 0 elementos
}
```

Los arrays `packages`, `classes` y `associations` deben estar presentes aunque estén vacíos. La ausencia de cualquiera de ellos es un error.

### 3.2 Package (paquete)

Un paquete es un espacio de nombres lógico. Agrupa clases sin imponer estructura de carpetas ni módulo de compilación.

| Campo | Tipo | Obligatorio | Restricciones |
|---|---|---|---|
| `id` | string | sí | Único en el documento. |
| `name` | string | sí | Identificador válido: `[A-Za-z_][A-Za-z0-9_]*`. Único entre hermanos bajo el mismo padre. |
| `parentId` | string | no | Referencia al `id` de un paquete padre. Si está presente, el paquete referenciado debe existir. Ausente → paquete raíz. |
| `description` | string | no | Texto libre. |

**Restricciones:**
- No se permiten ciclos en la jerarquía de paquetes (detección por DFS).
- Un modelo puede no tener paquetes; en ese caso `classes` se considera en el espacio de nombres raíz.

### 3.3 Class (clase)

Representa una entidad del dominio persistible o un objeto de valor.

| Campo | Tipo | Obligatorio | Restricciones |
|---|---|---|---|
| `id` | string | sí | Único en el documento. |
| `name` | string | sí | `[A-Za-z_][A-Za-z0-9_]*`. Único dentro del mismo paquete (o a nivel raíz si no hay paquete). |
| `packageId` | string | no | Referencia al `id` de un Package existente. |
| `isAbstract` | boolean | no | Por defecto `false`. |
| `description` | string | no | Texto libre. |
| `attributes` | [ Attribute ] | sí | Array, puede estar vacío. |

**Restricciones:**
- Dos clases no pueden tener el mismo `name` dentro del mismo `packageId` (o en el mismo nivel raíz).
- Una clase abstracta puede no tener atributos propios.

### 3.4 Attribute (atributo)

Propiedad tipada de una clase.

| Campo | Tipo | Obligatorio | Restricciones |
|---|---|---|---|
| `id` | string | sí | Único en el documento. |
| `name` | string | sí | `[A-Za-z_][A-Za-z0-9_]*`. Único dentro de la clase que lo contiene. |
| `type` | string | sí | Ver §3.5. |
| `nullable` | boolean | sí | `true` → el atributo admite valor nulo. |
| `multiplicity` | string | sí | Ver §3.6. |
| `description` | string | no | Texto libre. |

### 3.5 Tipos permitidos (corte mínimo)

El campo `type` de un atributo debe ser uno de los siguientes literales de cadena:

| Literal | Semántica |
|---|---|
| `"String"` | Texto de longitud arbitraria. |
| `"Integer"` | Entero de precisión no especificada. |
| `"Long"` | Entero de 64 bits. |
| `"Double"` | Número de punto flotante de doble precisión. |
| `"Boolean"` | Valor verdadero/falso. |
| `"Date"` | Fecha de calendario (sin hora). |
| `"DateTime"` | Fecha y hora. Zona horaria no impuesta por el contrato. |
| `"UUID"` | Identificador único universal. |

Los tipos de colección (`List<T>`, `Set<T>`) no forman parte del corte mínimo v1; se modelan mediante asociaciones (§3.7).

Un tipo no listado es un error que el validador debe reportar con diagnóstico `UNKNOWN_TYPE`.

### 3.6 Multiplicidad

El campo `multiplicity` de un atributo acepta los siguientes literales:

| Literal | Semántica |
|---|---|
| `"1"` | Exactamente uno. Implica `nullable: false` a menos que se indique lo contrario. |
| `"0..1"` | Cero o uno (opcional). Implica `nullable: true`. |
| `"1..*"` | Uno o más (en atributos simples, use asociaciones para colecciones). |
| `"0..*"` | Cero o más (preferir asociaciones para colecciones). |

**Regla de coherencia:** Si `multiplicity` es `"1"` y `nullable` es `true`, el validador emite una advertencia `NULLABLE_REQUIRED_CONFLICT`. Si `multiplicity` es `"0..1"` y `nullable` es `false`, el validador emite una advertencia `NOT_NULLABLE_OPTIONAL_CONFLICT`.

### 3.7 Association (asociación)

Relación navegable entre dos clases.

| Campo | Tipo | Obligatorio | Restricciones |
|---|---|---|---|
| `id` | string | sí | Único en el documento. |
| `name` | string | no | Nombre de la relación. Texto libre. |
| `sourceClassId` | string | sí | `id` de la clase origen. Debe existir. |
| `targetClassId` | string | sí | `id` de la clase destino. Debe existir. |
| `sourceMultiplicity` | string | sí | Uno de los literales de §3.6. |
| `targetMultiplicity` | string | sí | Uno de los literales de §3.6. |
| `navigability` | string | sí | `"unidirectional"` (origen → destino) o `"bidirectional"`. |
| `kind` | string | no | Tipo UML (ADR-0009): `"association"` (por defecto), `"aggregation"`, `"composition"`, `"generalization"`, `"dependency"` o `"associationClass"`. |
| `associationClassId` | string | no | Obligatorio si `kind = "associationClass"`; `id` de la clase que porta los atributos del vínculo. |
| `description` | string | no | Texto libre. |

**Restricciones:**
- `sourceClassId` ≠ `targetClassId` (no se admiten auto-asociaciones en el corte mínimo v1).
- Ambos extremos de la asociación deben referenciar clases que existen en el documento.
- `generalization`: source = clase hija, target = padre. No se permiten ciclos de herencia ni más de una generalización por clase hija (herencia simple). Las multiplicidades/navegabilidad se ignoran.
- `dependency`: relación de uso dirigida; no produce asociación persistente en la generación.
- `composition`: el `targetClassId` (parte) no puede ser parte de más de una composición.
- `associationClass`: `associationClassId` debe referenciar una clase existente.

---

## 4. Orden canónico y determinismo

Para que los resultados de validación y generación sean deterministas e idempotentes, el modelo canónico define un **orden canónico** para cada array:

| Array | Clave de ordenación primaria | Clave secundaria |
|---|---|---|
| `packages` | `id` ASC | — |
| `classes` | `packageId` ASC (nulos primero), luego `id` ASC | — |
| `classes[*].attributes` | `id` ASC | — |
| `associations` | `sourceClassId` ASC, luego `id` ASC | — |

**Reglas:**
1. Los generadores y validadores deben procesar los arrays en el orden canónico independientemente del orden en que aparezcan en el archivo de entrada.
2. Los comparadores que necesitan igualdad estructural entre dos documentos deben normalizar ambos al orden canónico antes de comparar.
3. Dos documentos son **canónicamente iguales** si, tras normalización del orden, son iguales byte a byte en su representación JSON con separadores mínimos (sin espacios en blanco adicionales).
4. Un documento que no siga el orden canónico es válido pero no normalizado. El validador puede emitir una advertencia `OUT_OF_CANONICAL_ORDER` no bloqueante.

---

## 5. Información mínima requerida por capas

Este contrato no impone la implementación de ninguna capa, pero declara qué información mínima cada capa consumidora necesita extraer del modelo.

### 5.1 Capas Spring Boot

| Capa | Información mínima requerida del modelo |
|---|---|
| **Entity** | `class.id`, `class.name`, `class.packageId`, `attribute.name`, `attribute.type`, `attribute.nullable`, `attribute.multiplicity`, `association.targetClassId`, `association.targetMultiplicity` |
| **DTO** | `class.id`, `class.name`, `attribute.name`, `attribute.type`, `attribute.nullable`, `attribute.multiplicity` |
| **Repository** | `class.id`, `class.name` (para derivar el nombre del repositorio) |
| **Service** | `class.id`, `class.name`, `association.*` (para lógica de navegación) |
| **Controller** | `class.id`, `class.name` (para derivar rutas REST); `attribute.name`, `attribute.type` (para validación de entrada) |

Toda clase presente en el modelo genera las cinco capas. No existe mecanismo v1 para excluir una clase de la generación.

### 5.2 Descriptor Flutter

| Información requerida | Uso |
|---|---|
| `contractVersion` del modelo fuente | Trazabilidad y compatibilidad del descriptor |
| `id` y `version` del modelo fuente | Vinculación del descriptor a una versión concreta del modelo |
| `class.id`, `class.name` | Identificación de widgets/formularios dinámicos |
| `attribute.name`, `attribute.type`, `attribute.nullable`, `attribute.multiplicity` | Generación de formularios, validaciones UI y navegación offline |
| `association.sourceClassId`, `association.targetClassId`, `association.targetMultiplicity`, `association.navigability` | Renderizado de relaciones y carga diferida |

El descriptor Flutter es un artefacto derivado. Debe declarar la `version` y el `id` del `domain-model.json` del que fue generado (trazabilidad de origen), conforme a la invariante 4 de `docs/ARCHITECTURE.md`.

---

## 6. Ejemplos JSON normativos

### 6.1 Ejemplo mínimo válido

```json
{
  "contractVersion": "1",
  "id": "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
  "name": "Biblioteca",
  "version": "1.0.0",
  "packages": [
    {
      "id": "pkg-01",
      "name": "biblioteca"
    }
  ],
  "classes": [
    {
      "id": "cls-01",
      "name": "Libro",
      "packageId": "pkg-01",
      "isAbstract": false,
      "attributes": [
        {
          "id": "attr-01",
          "name": "titulo",
          "type": "String",
          "nullable": false,
          "multiplicity": "1"
        },
        {
          "id": "attr-02",
          "name": "isbn",
          "type": "String",
          "nullable": false,
          "multiplicity": "1"
        },
        {
          "id": "attr-03",
          "name": "fechaPublicacion",
          "type": "Date",
          "nullable": true,
          "multiplicity": "0..1"
        }
      ]
    },
    {
      "id": "cls-02",
      "name": "Autor",
      "packageId": "pkg-01",
      "isAbstract": false,
      "attributes": [
        {
          "id": "attr-04",
          "name": "nombre",
          "type": "String",
          "nullable": false,
          "multiplicity": "1"
        }
      ]
    }
  ],
  "associations": [
    {
      "id": "assoc-01",
      "name": "escritoPor",
      "sourceClassId": "cls-01",
      "targetClassId": "cls-02",
      "sourceMultiplicity": "0..*",
      "targetMultiplicity": "1..*",
      "navigability": "bidirectional"
    }
  ]
}
```

### 6.2 Ejemplos inválidos con diagnóstico esperado

#### 6.2.1 Falta `contractVersion`

```json
{
  "id": "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
  "name": "ModeloSinVersion",
  "version": "1.0.0",
  "packages": [],
  "classes": [],
  "associations": []
}
```

**Diagnóstico esperado:**
- Código: `MISSING_REQUIRED_FIELD`
- Ruta: `$.contractVersion`
- Mensaje: "El campo 'contractVersion' es obligatorio."
- Severidad: `ERROR` (bloqueante; no se genera código)

#### 6.2.2 Tipo de atributo desconocido

```json
{
  "contractVersion": "1",
  "id": "aaa",
  "name": "Modelo",
  "version": "1.0.0",
  "packages": [],
  "classes": [
    {
      "id": "cls-x",
      "name": "Entidad",
      "attributes": [
        {
          "id": "attr-x",
          "name": "campo",
          "type": "BigDecimal",
          "nullable": false,
          "multiplicity": "1"
        }
      ]
    }
  ],
  "associations": []
}
```

**Diagnóstico esperado:**
- Código: `UNKNOWN_TYPE`
- Ruta: `$.classes[0].attributes[0].type`
- Mensaje: "Tipo 'BigDecimal' no reconocido en el corte mínimo v1."
- Severidad: `ERROR` (bloqueante)

#### 6.2.3 Asociación referencia clase inexistente

```json
{
  "contractVersion": "1",
  "id": "bbb",
  "name": "Modelo",
  "version": "1.0.0",
  "packages": [],
  "classes": [
    {
      "id": "cls-a",
      "name": "ClaseA",
      "attributes": []
    }
  ],
  "associations": [
    {
      "id": "assoc-z",
      "sourceClassId": "cls-a",
      "targetClassId": "cls-no-existe",
      "sourceMultiplicity": "1",
      "targetMultiplicity": "1",
      "navigability": "unidirectional"
    }
  ]
}
```

**Diagnóstico esperado:**
- Código: `UNRESOLVED_REFERENCE`
- Ruta: `$.associations[0].targetClassId`
- Mensaje: "La clase 'cls-no-existe' no existe en el documento."
- Severidad: `ERROR` (bloqueante)

#### 6.2.4 Nombres de clase duplicados en el mismo paquete

```json
{
  "contractVersion": "1",
  "id": "ccc",
  "name": "Modelo",
  "version": "1.0.0",
  "packages": [{ "id": "pkg-a", "name": "paquete" }],
  "classes": [
    { "id": "cls-1", "name": "Entidad", "packageId": "pkg-a", "attributes": [] },
    { "id": "cls-2", "name": "Entidad", "packageId": "pkg-a", "attributes": [] }
  ],
  "associations": []
}
```

**Diagnóstico esperado:**
- Código: `DUPLICATE_NAME`
- Ruta: `$.classes[1].name`
- Mensaje: "Nombre 'Entidad' duplicado en el paquete 'pkg-a'."
- Severidad: `ERROR` (bloqueante)

#### 6.2.5 Conflicto nullable/multiplicity (advertencia no bloqueante)

```json
{
  "contractVersion": "1",
  "id": "ddd",
  "name": "Modelo",
  "version": "1.0.0",
  "packages": [],
  "classes": [
    {
      "id": "cls-1",
      "name": "Entidad",
      "attributes": [
        {
          "id": "attr-1",
          "name": "campo",
          "type": "String",
          "nullable": true,
          "multiplicity": "1"
        }
      ]
    }
  ],
  "associations": []
}
```

**Diagnóstico esperado:**
- Código: `NULLABLE_REQUIRED_CONFLICT`
- Ruta: `$.classes[0].attributes[0]`
- Mensaje: "El atributo tiene multiplicity '1' pero nullable es true."
- Severidad: `WARNING` (no bloqueante; el generador puede continuar)

---

## 7. Decisiones cerradas, supuestos y preguntas abiertas

### 7.1 Decisiones cerradas (no revisables en v1)

| # | Decisión | Fuente |
|---|---|---|
| D1 | El modelo canónico es la única fuente de verdad; ningún adaptador externo lo sustituye. | ADR-0000 |
| D2 | Las cinco capas Spring (Entity, DTO, Repository, Service, Controller) son obligatorias. | PROJECT.md, ARCHITECTURE.md |
| D3 | Flutter consume `domain-model.json` o un descriptor trazable derivado de este. | ADR-0000 |
| D4 | PostgreSQL se usa mediante JPA/Hibernate en los proyectos generados. | ARCHITECTURE.md (invariante 6) |
| D5 | Una entrada inválida no produce código parcial aceptable. | ARCHITECTURE.md (invariante 2) |
| D6 | Este contrato no elige lenguaje, framework, librería de validación ni motor de plantillas. | Tarea P1-001 |
| D7 | Política de campos desconocidos: ignorar y preservar (evolución hacia adelante). | §2.3 de este contrato |
| D8 | El orden canónico es obligatorio para determinismo; el incumplimiento es advertencia, no error. | §4 de este contrato |

### 7.2 Supuestos registrados

| # | Supuesto | Consecuencia si es incorrecto |
|---|---|---|
| S1 | Los tipos primitivos del §3.5 son suficientes para el corte mínimo del parcial. | Se necesitaría una revisión v1 o un `contractVersion` `"2"` con ADR. |
| S2 | No se modelan herencia ni interfaces en el corte mínimo v1. | Una subclase no puede referenciar un padre; la herencia se introduce en v2. |
| S3 | No se modelan enumeraciones como tipo de atributo en v1. | Los valores enum no son validables en v1; se requeriría extensión de tipos. |
| S4 | Las auto-asociaciones (bucles) no son necesarias en el corte mínimo. | Si el dominio las requiere, el validador necesita actualización. |
| S5 | Un modelo sin clases es válido (arrays vacíos). | Si se quiere forzar al menos una clase, se necesita cambio de contrato. |

### 7.3 Preguntas que requieren aprobación del Product Owner

| # | Pregunta | Impacto |
|---|---|---|
| Q1 | ¿Deben los `id` de clases y atributos ser UUIDs v4 o se aceptan slugs arbitrarios? | El validador necesita una regla de formato de `id`. |
| Q2 | ¿Se requiere que los paquetes se mapeen a namespaces Java en la generación Spring? | Afecta al contrato `generator-input-output` y al nombre de paquetes Java. |
| Q3 | ¿El descriptor Flutter es idéntico al `domain-model.json` o es un subconjunto proyectado? | Afecta al contrato `flutter-descriptor` (pendiente de definición). |
| Q4 | ¿Se requiere un campo `createdAt`/`updatedAt` automático en todas las entidades generadas? | Si sí, debe añadirse al contrato como campo implícito o como `attribute` con `type` especial. |
| Q5 | ¿El campo `version` del documento de modelo sigue semver estricto o es una cadena libre? | Afecta a la regla de parsing del validador. |

---

## 8. Política de cambios al contrato

1. **Cambio compatible (nueva versión menor del documento):** añadir campos opcionales, ampliar enumeraciones de tipos o relajar restricciones. Requiere actualizar este documento y comunicarlo a los consumidores; no requiere ADR.
2. **Cambio incompatible (nueva `contractVersion`):** eliminar o renombrar campos obligatorios, cambiar semántica de tipos, endurecer restricciones existentes. Requiere ADR aceptado por el Product Owner y nueva versión del contrato (`domain-model-v2.md`).
3. Los generadores y validadores deben declarar explícitamente qué `contractVersion` soportan.
4. La coexistencia de múltiples versiones del contrato es posible; cada fichero `domain-model.json` declara la suya.
