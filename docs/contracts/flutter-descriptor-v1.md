# Contrato del descriptor Flutter — `flutter-descriptor` v1

- **Versión del contrato:** 1.0.0
- **Estado:** accepted
- **Fecha:** 2026-09-19
- **Autoridad:** Product Owner (ADR-0000, PROJECT.md)
- **Depende de:** `domain-model` v1 (`docs/contracts/domain-model-v1.md`)
- **Producido por:** generador determinista (`docs/contracts/generator-input-output-v1.md`)

---

## 1. Propósito y alcance

Este contrato define la estructura, semántica, trazabilidad y reglas de compatibilidad del descriptor Flutter (`flutter-descriptor.json`). El descriptor es un artefacto derivado del modelo canónico, proyectado y adaptado para el consumo eficiente por la aplicación móvil Flutter sin requerir acceso al `domain-model.json` completo en tiempo de ejecución.

El descriptor permite a Flutter:

- Construir formularios y vistas dinámicas a partir de la estructura de clases y atributos del dominio.
- Aplicar validaciones de UI coherentes con el modelo canónico.
- Navegar y renderizar asociaciones entre entidades.
- Operar en modo offline con un snapshot del modelo de dominio.
- Trazar de forma verificable cualquier versión del descriptor a la versión exacta del modelo del que fue generado.

El contrato **no** elige framework de estado Flutter, motor de renderizado de formularios ni versión concreta del SDK de Flutter. Esas decisiones requieren ADR aceptados separados (véase ADR-0004 pendiente).

---

## 2. Versión e identidad del contrato

### 2.1 Campo de versión del contrato

Todo fichero `flutter-descriptor.json` debe declarar la versión de este contrato:

```
"descriptorContractVersion": "1"
```

Los consumidores Flutter deben rechazar descriptores cuya `descriptorContractVersion` no coincida con la que soportan.

### 2.2 Identidad y trazabilidad de origen

El descriptor es un artefacto derivado. Para garantizar trazabilidad completa al modelo canónico del que fue generado, declara obligatoriamente los siguientes campos de origen:

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `descriptorContractVersion` | string | sí | Versión de este contrato. Valor `"1"` para esta versión. |
| `descriptorVersion` | string | sí | Versión del descriptor mismo. Formato `MAJOR.MINOR.PATCH`. Debe incrementarse ante cualquier cambio en el contenido generado. |
| `sourceModelId` | string | sí | Valor del campo `id` del `domain-model.json` origen. Inmutable; identifica el modelo sin importar renombrados. |
| `sourceModelVersion` | string | sí | Valor del campo `version` del `domain-model.json` origen. Permite detectar cambios de modelo. |
| `sourceModelContractVersion` | string | sí | Valor del campo `contractVersion` del `domain-model.json` origen. Siempre `"1"` cuando este descriptor fue generado desde `domain-model` v1. |
| `sourceModelSha256` | string | sí | SHA-256 del documento `domain-model.json` normalizado (orden canónico, separadores mínimos, UTF-8). Permite verificar que el descriptor corresponde a exactamente ese modelo. |
| `generatorVersion` | string | sí | Versión del generador que produjo este descriptor. Para trazabilidad y reproducibilidad. |

### 2.3 Compatibilidad con `domain-model`

| Versión de este contrato | Versión de `domain-model` requerida |
|---|---|
| `"1"` | `"1"` |

---

## 3. Estructura del descriptor

### 3.1 Documento raíz

```
{
  "descriptorContractVersion": string,   // obligatorio
  "descriptorVersion": string,           // obligatorio
  "sourceModelId": string,               // obligatorio
  "sourceModelVersion": string,          // obligatorio
  "sourceModelContractVersion": string,  // obligatorio
  "sourceModelSha256": string,           // obligatorio
  "generatorVersion": string,            // obligatorio
  "classes": [ ClassDescriptor ],        // obligatorio, ≥ 0 elementos
  "associations": [ AssociationDescriptor ] // obligatorio, ≥ 0 elementos
}
```

Los arrays `classes` y `associations` deben estar presentes aunque estén vacíos.

### 3.2 ClassDescriptor

Proyección de una clase del modelo canónico relevante para Flutter.

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `id` | string | sí | `id` de la clase en el modelo canónico. Clave de trazabilidad; no cambia al renombrar. |
| `name` | string | sí | `name` de la clase en el modelo canónico. Nombre legible para etiquetas de UI. |
| `packageName` | string \| null | no | Siempre `null`: el modelo canónico tiene un único paquete raíz (`domain-model-v1` §3.2). Se conserva el campo por compatibilidad de schema. |
| `description` | string | no | `description` de la clase en el modelo canónico. Puede usarse como tooltip o ayuda contextual. |
| `attributes` | [ AttributeDescriptor ] | sí | Lista de descriptores de atributos. Puede estar vacía. |

### 3.3 AttributeDescriptor

Proyección de un atributo de clase para renderizado y validación en Flutter.

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `id` | string | sí | `id` del atributo en el modelo canónico. |
| `name` | string | sí | `name` del atributo. Usado como nombre de campo en formularios. |
| `type` | string | sí | Tipo del atributo según §3.5 de `domain-model` v1. Uno de: `String`, `Integer`, `Long`, `Double`, `Boolean`, `Date`, `DateTime`, `UUID`. |
| `nullable` | boolean | sí | Si `true`, el campo de formulario admite valor vacío/nulo. |
| `multiplicity` | string | sí | Multiplicidad del atributo según §3.6 de `domain-model` v1. |
| `uiType` | string | sí | Tipo de widget UI recomendado. Ver §4 (tabla de mapeo). |
| `required` | boolean | sí | `true` si el campo es obligatorio en UI. Derivado de `nullable: false` y `multiplicity: "1"`. |
| `description` | string | no | `description` del atributo. Texto de ayuda en UI. |

### 3.4 AssociationDescriptor

Proyección de una asociación para renderizado de relaciones y carga diferida en Flutter.

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `id` | string | sí | `id` de la asociación en el modelo canónico. |
| `name` | string | no | `name` de la asociación. Etiqueta de relación en UI. |
| `sourceClassId` | string | sí | `id` de la clase origen. Referencia a `ClassDescriptor.id`. |
| `targetClassId` | string | sí | `id` de la clase destino. Referencia a `ClassDescriptor.id`. |
| `sourceMultiplicity` | string | sí | Multiplicidad del extremo origen. |
| `targetMultiplicity` | string | sí | Multiplicidad del extremo destino. |
| `navigability` | string | sí | `"unidirectional"` o `"bidirectional"`. Determina si Flutter renderiza la relación en una o ambas vistas. |
| `relationType` | string | sí | Tipo de relación inferido. Ver §5. |
| `isLazyLoadable` | boolean | sí | `true` si la relación es candidata a carga diferida en modo offline. Ver §5.2. |
| `description` | string | no | `description` de la asociación. |

---

## 4. Mapeo de tipos a widgets UI (`uiType`)

El campo `uiType` de `AttributeDescriptor` es determinista: dado el `type` y `multiplicity` del atributo en el modelo, el valor de `uiType` es siempre el mismo.

| `type` | `multiplicity` | `uiType` |
|---|---|---|
| `String` | `"1"` o `"0..1"` | `"textField"` |
| `String` | `"1..*"` o `"0..*"` | `"textList"` |
| `Integer` | cualquiera | `"integerField"` |
| `Long` | cualquiera | `"integerField"` |
| `Double` | cualquiera | `"decimalField"` |
| `Boolean` | cualquiera | `"checkbox"` |
| `Date` | cualquiera | `"datePicker"` |
| `DateTime` | cualquiera | `"dateTimePicker"` |
| `UUID` | cualquiera | `"uuidField"` |

El `uiType` es una recomendación al runtime Flutter; la implementación puede sustituirlo por un widget más específico sin violar el contrato, siempre que preserve la semántica de validación.

---

## 5. Inferencia de tipo de relación y carga diferida

### 5.1 `relationType`

El campo `relationType` de `AssociationDescriptor` se deriva determinísticamente de las multiplicidades del modelo:

| `sourceMultiplicity` | `targetMultiplicity` | `relationType` |
|---|---|---|
| `"1"` o `"0..1"` | `"1"` o `"0..1"` | `"oneToOne"` |
| `"0..*"` o `"1..*"` | `"1"` o `"0..1"` | `"manyToOne"` |
| `"1"` o `"0..1"` | `"0..*"` o `"1..*"` | `"oneToMany"` |
| `"0..*"` o `"1..*"` | `"0..*"` o `"1..*"` | `"manyToMany"` |

### 5.2 `isLazyLoadable`

Una asociación es candidata a carga diferida (`isLazyLoadable: true`) si su `relationType` es `"oneToMany"` o `"manyToMany"`. Las relaciones `"oneToOne"` y `"manyToOne"` tienen `isLazyLoadable: false`.

---

## 6. Orden canónico del descriptor

Para garantizar determinismo e idempotencia, el descriptor usa el siguiente orden canónico:

| Array | Clave de ordenación |
|---|---|
| `classes` | `id` ASC |
| `classes[*].attributes` | `id` ASC |
| `associations` | `sourceClassId` ASC, luego `id` ASC |

Dos descriptores son **canónicamente iguales** si, tras normalización del orden, son iguales byte a byte en su representación JSON con separadores mínimos (sin espacios en blanco adicionales). Esta igualdad es la base del criterio de reproducibilidad del descriptor.

---

## 7. Reproducibilidad

El descriptor es reproducible bajo las mismas condiciones que el generador: dado el mismo `domain-model.json` de origen (canónicamente igual), la misma versión del generador y el mismo `templateSetId`, el contenido del `flutter-descriptor.json` es byte a byte idéntico entre ejecuciones.

El campo `sourceModelSha256` permite verificar que un descriptor dado corresponde exactamente a un modelo concreto. Si el modelo cambia (aunque sea mínimamente), el `sourceModelSha256` difiere y el runtime Flutter puede detectar la inconsistencia comparando con el SHA-256 que el servidor publica como metadato del modelo activo (ver §10.2).

---

## 8. Semántica de errores del descriptor

### 8.1 Errores en tiempo de generación

El descriptor se genera en la misma ejecución atómica que el proyecto Spring Boot (§9 de `generator-input-output` v1). Si la generación del descriptor falla, se aplica la misma semántica de atomicidad: no se produce ningún artefacto y se emite el informe de error.

| Código | Descripción | Severidad |
|---|---|---|
| `DESCRIPTOR_WRITE_ERROR` | Error de escritura del fichero `flutter-descriptor.json`. | `ERROR` |
| `DESCRIPTOR_TYPE_MAPPING_ERROR` | Un tipo de atributo del modelo no tiene mapeo definido en §4. Indica que el modelo tiene un `type` no soportado en v1 que superó la validación previa. | `ERROR` |

### 8.2 Errores en tiempo de consumo (runtime Flutter)

| Código | Descripción | Acción recomendada |
|---|---|---|
| `DESCRIPTOR_CONTRACT_VERSION_MISMATCH` | `descriptorContractVersion` no coincide con la versión soportada por el runtime. | Rechazar el descriptor; solicitar regeneración. |
| `DESCRIPTOR_MODEL_MISMATCH` | `sourceModelSha256` no coincide con el SHA-256 del modelo activo publicado por el servidor como metadato (sin requerir `domain-model.json` completo en el runtime). El descriptor es stale. | Notificar al usuario; continuar en modo degradado o rechazar. |
| `DESCRIPTOR_MISSING_REQUIRED_FIELD` | Falta un campo obligatorio del descriptor. | Rechazar el descriptor. |

---

## 9. Invariantes del contrato

| # | Invariante |
|---|---|
| I1 | El descriptor declara `sourceModelId`, `sourceModelVersion`, `sourceModelContractVersion` y `sourceModelSha256` en todo momento (trazabilidad de origen). |
| I2 | El descriptor es un artefacto de solo lectura; el runtime Flutter no lo modifica. |
| I3 | Mismo modelo canónico + misma versión del generador = mismo descriptor byte a byte (reproducibilidad). |
| I4 | El campo `uiType` es determinista: está completamente determinado por `type` y `multiplicity` del atributo en el modelo. |
| I5 | El campo `relationType` es determinista: está completamente determinado por `sourceMultiplicity` y `targetMultiplicity` de la asociación. |
| I6 | El descriptor no contiene lógica de negocio ni reglas de validación propias; refleja el modelo canónico. |
| I7 | Todo `id` en el descriptor referencia directamente el `id` correspondiente en el `domain-model.json` origen. |

---

## 10. Ejemplos normativos

### 10.1 Descriptor mínimo válido

Generado desde el modelo `valid-minimal.json` (clase `Libro`, atributos `titulo: String/1`, `isbn: String/1`, `fechaPublicacion: Date/0..1`; asociación `escritoPor` hacia `Autor`):

```json
{
  "descriptorContractVersion": "1",
  "descriptorVersion": "1.0.0",
  "sourceModelId": "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
  "sourceModelVersion": "1.0.0",
  "sourceModelContractVersion": "1",
  "sourceModelSha256": "<sha256 del contenido normalizado exacto del modelo normativo>",
  "generatorVersion": "1.0.0",
  "classes": [
    {
      "id": "cls-01",
      "name": "Libro",
      "packageName": null,
      "description": null,
      "attributes": [
        {
          "id": "attr-01",
          "name": "titulo",
          "type": "String",
          "nullable": false,
          "multiplicity": "1",
          "uiType": "textField",
          "required": true,
          "description": null
        },
        {
          "id": "attr-02",
          "name": "isbn",
          "type": "String",
          "nullable": false,
          "multiplicity": "1",
          "uiType": "textField",
          "required": true,
          "description": null
        },
        {
          "id": "attr-03",
          "name": "fechaPublicacion",
          "type": "Date",
          "nullable": true,
          "multiplicity": "0..1",
          "uiType": "datePicker",
          "required": false,
          "description": null
        }
      ]
    },
    {
      "id": "cls-02",
      "name": "Autor",
      "packageName": null,
      "description": null,
      "attributes": [
        {
          "id": "attr-04",
          "name": "nombre",
          "type": "String",
          "nullable": false,
          "multiplicity": "1",
          "uiType": "textField",
          "required": true,
          "description": null
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
      "navigability": "bidirectional",
      "relationType": "manyToMany",
      "isLazyLoadable": true,
      "description": null
    }
  ]
}
```

### 10.2 Verificación de trazabilidad

Para verificar que el descriptor es coherente con el modelo activo:

1. Solicitar al servidor el SHA-256 del modelo activo (endpoint de metadatos; el servidor calcula y expone este valor sin transferir el `domain-model.json` completo al runtime).
2. Comparar con `sourceModelSha256` del descriptor local.
3. Si difieren → el descriptor es stale → emitir `DESCRIPTOR_MODEL_MISMATCH`.

El runtime no necesita acceder ni parsear `domain-model.json` directamente. El SHA-256 es un metadato de modelo publicado por el servidor como valor escalar.

### 10.3 Clase abstracta — sin formulario de creación


---

## 11. Compatibilidad y migración

### 11.1 Cambios compatibles (nueva versión menor de este documento)

- Añadir campos opcionales a `ClassDescriptor`, `AttributeDescriptor` o `AssociationDescriptor`.
- Ampliar la tabla de `uiType` con nuevos tipos de atributo.
- Añadir nuevos valores de `relationType` para casos no cubiertos.
- Añadir campos opcionales al documento raíz.

### 11.2 Cambios incompatibles (requieren `descriptorContractVersion: "2"` y ADR aceptado)

- Eliminar o renombrar campos obligatorios del documento raíz o de los descriptores.
- Cambiar la semántica de `uiType` o `relationType`.
- Cambiar las reglas de trazabilidad (`sourceModelId`, `sourceModelSha256`).
- Modificar la estructura de `AssociationDescriptor` de forma que altere el comportamiento existente.

### 11.3 Coexistencia de versiones

El runtime Flutter debe declarar qué `descriptorContractVersion` soporta. Un descriptor de versión no soportada debe rechazarse con `DESCRIPTOR_CONTRACT_VERSION_MISMATCH`.

---

## 12. Política de campos desconocidos

El runtime Flutter debe ignorar y preservar campos no declarados en este contrato (política _ignore-unknown_), de forma coherente con §2.3 de `domain-model` v1. Esta política permite evolución compatible hacia adelante.

---

## 13. Decisiones cerradas, supuestos y preguntas abiertas

### 13.1 Decisiones cerradas

| # | Decisión | Fuente |
|---|---|---|
| D1 | El descriptor declara `sourceModelId`, `sourceModelVersion` y `sourceModelSha256` para trazabilidad completa. | ARCHITECTURE.md invariante 4, ADR-0000 |
| D2 | El descriptor es de solo lectura; no se modifica en runtime. | ADR-0000 |
| D3 | El mapeo `uiType` es determinista y exhaustivo para los tipos de `domain-model` v1. | Tarea P2-001 |
| D4 | El `relationType` es determinista y se deriva de las multiplicidades. | Tarea P2-001 |
| D5 | Reproducibilidad byte a byte del descriptor bajo las condiciones de `generator-input-output` v1 §4.1. | ADR-0000, ARCHITECTURE.md invariante 3 |
| D6 | No se elige framework de estado Flutter ni motor de renderizado en este contrato. | Tarea P2-001, ADR-0004 pendiente |

### 13.2 Supuestos registrados

| # | Supuesto | Consecuencia si es incorrecto |
|---|---|---|
| S1 | El descriptor se consume tal cual por Flutter sin transformación adicional. | Si Flutter necesita un formato binario o comprimido, se necesita una capa de adaptación. |
| S2 | El runtime Flutter puede identificar un descriptor stale comparando `sourceModelSha256`. | Si el runtime no tiene acceso al `domain-model.json` activo, la comparación no es posible sin servicio. |
| S3 | No se modelan enumeraciones en v1; los `uiType` de selección (dropdown) no son necesarios. | Si el dominio requiere enums, se necesita extensión del contrato de tipos en `domain-model` v2. |
| S4 | El descriptor no incluye datos de instancia (filas de base de datos); solo metadatos del modelo. | Si Flutter necesita datos de ejemplo, se requiere un contrato separado. |

### 13.3 Preguntas abiertas que requieren aprobación del Product Owner

| # | Pregunta | Impacto |
|---|---|---|
| Q1 | ¿El descriptor debe incluir información de internacionalización (i18n) de etiquetas de UI? | Si sí, se añade un campo `label` localizable a `AttributeDescriptor`. |
| Q2 | ¿El runtime Flutter debe soportar descriptores stale en modo degradado o rechazarlos siempre? | Afecta a la política de `DESCRIPTOR_MODEL_MISMATCH`. |
| Q3 | ¿El descriptor se entrega embebido en el paquete Flutter o se descarga en runtime desde el servidor? | Afecta a ADR-0004 y al ciclo de actualización del descriptor. |
| Q4 | ¿Se requiere un campo de orden de presentación (`displayOrder`) en `AttributeDescriptor` para controlar el orden de campos en formularios? | Si sí, se añade como campo opcional en v1 o se introduce en v2. |


---

## 14. Estados de ciclo de vida del descriptor en runtime Flutter

### 14.1 Máquina de estados del descriptor

El runtime Flutter gestiona el descriptor mediante los siguientes estados bien definidos. Cada estado determina qué UI se puede mostrar y qué acciones están permitidas.

| Estado | Identificador | Descripción |
|---|---|---|
| Cargando | `loading` | El descriptor se está obteniendo (red o almacenamiento local). No se renderiza UI dinámica aún. |
| Listo | `ready` | El descriptor se cargó, se verificó la `descriptorContractVersion` y todos los campos obligatorios están presentes. La UI dinámica completa está disponible. |
| Versión incompatible | `error_contract_mismatch` | `descriptorContractVersion` no coincide con la versión que soporta el runtime. Corresponde al error `DESCRIPTOR_CONTRACT_VERSION_MISMATCH` (§8.2). |
| Campo requerido ausente | `error_missing_field` | Falta al menos un campo obligatorio del documento raíz o de un descriptor anidado. Corresponde a `DESCRIPTOR_MISSING_REQUIRED_FIELD` (§8.2). |
| Desactualizado | `stale` | El descriptor se cargó correctamente pero `sourceModelSha256` no coincide con el SHA-256 que el servidor publica para el modelo activo (servido como metadato independiente, sin requerir `domain-model.json` completo en el runtime). Corresponde a `DESCRIPTOR_MODEL_MISMATCH` (§8.2). El runtime puede operar en modo degradado (ver §14.3). |
| Sin descriptor | `unavailable` | No existe descriptor almacenado localmente y no hay conectividad para descargarlo. Sin descriptor no hay `uiType` conocidos; el runtime no puede renderizar UI dinámica ni encolar ediciones. |

**Transiciones válidas:**

```
         [inicio]
             |
             v
         loading
          /    \
         v      v
       ready   error_contract_mismatch
         |      |
         |      v
         |   [bloquear UI dinámica; mostrar mensaje de error]
         |
         +---> stale
         |       |
         |       v
         |   [modo degradado: UI con datos locales, sin sincronización]
         |
         +---> error_missing_field
         |       |
         |       v
         |   [bloquear UI dinámica; mostrar mensaje de error]
         |
         +---> unavailable
                 |
                 v
         [bloquear UI dinámica y edición; mostrar aviso de sin conexión ni descriptor]
```

### 14.2 Comportamiento requerido por estado

| Estado | Renderizado UI dinámica | Edición local | Sincronización | Mensaje al usuario |
|---|---|---|---|---|
| `loading` | No | No | No | Indicador de progreso |
| `ready` | Completo | Sí | Sí | Ninguno (operación normal) |
| `error_contract_mismatch` | No | No | No | Error bloqueante: solicitar actualización de la app |
| `error_missing_field` | No | No | No | Error bloqueante: descriptor corrupto, solicitar regeneración |
| `stale` | Parcial (datos locales) | Solo si esquema compatible (ver §14.3) | No (hasta resolver) | Advertencia no bloqueante: el modelo cambió |
| `unavailable` | No (sin descriptor local) | No | No | Aviso informativo: sin conexión ni descriptor local |

### 14.3 Modo degradado (`stale`)

Cuando el estado es `stale`, el runtime opera con el descriptor almacenado localmente bajo las siguientes restricciones:

1. **Compatibilidad de esquema:** el runtime evalúa si el descriptor local es compatible con los datos de instancia ya almacenados. Esta es la condición normativa única para permitir edición en `stale`:
   - Si el esquema es **compatible**, las operaciones de edición se encolan en la cola offline (ver `mobile-offline-v1.md §4.2`).
   - Si el esquema es **incompatible** con alguna entidad local, el runtime bloquea nuevas ediciones sobre esas entidades y notifica al usuario. Las operaciones ya encoladas no se cancelan.
2. No se solicita una nueva sincronización hasta que el usuario lo confirme explícitamente o se restablezca la conectividad.
3. El runtime no descarta el descriptor stale automáticamente; solo lo reemplaza cuando recibe un descriptor nuevo con `descriptorContractVersion` válida y `sourceModelSha256` verificado contra el metadato autenticado del servidor (ver §10.2).
4. El estado `stale` no impide el renderizado de los widgets ya conocidos; solo impide asumir que el modelo subyacente no ha cambiado.

### 14.4 Renderizado mínimo garantizado por `uiType`

Cuando el descriptor está presente localmente (estados `ready` y `stale`), el runtime debe ser capaz de renderizar una representación mínima para cada `uiType` conocido. Esta garantía **no aplica** al estado `unavailable`: sin descriptor local no hay `uiType` conocidos, por lo que el runtime debe mostrar únicamente un aviso de sin conexión y bloquear la edición. La representación mínima no precisa lógica de validación avanzada; solo debe permitir al usuario ver e introducir datos sin pérdida.

| `uiType` | Representación mínima garantizada | Validación mínima |
|---|---|---|
| `textField` | Campo de texto de una línea | Ninguna (aceptar cualquier cadena) |
| `textList` | Campo de texto multilínea o lista de entradas de texto | Ninguna |
| `integerField` | Campo de texto numérico (teclado numérico) | Rechazar caracteres no numéricos |
| `decimalField` | Campo de texto numérico con punto decimal | Rechazar caracteres no numéricos excepto separador decimal |
| `checkbox` | Control de alternancia booleana (checkbox o switch) | Ninguna |
| `datePicker` | Campo de texto con formato `YYYY-MM-DD` | Formato de fecha básico |
| `dateTimePicker` | Campo de texto con formato `YYYY-MM-DDTHH:MM` | Formato de fecha-hora básico |
| `uuidField` | Campo de texto de solo lectura (no se edita en UI) | Ninguna (el runtime genera el UUID) |

**Invariante de renderizado mínimo:** el runtime Flutter no debe mostrar una pantalla en blanco ni lanzar una excepción no controlada ante ningún valor de `uiType` declarado en este contrato. Si el runtime recibe un `uiType` desconocido (campo añadido en versión futura, política ignore-unknown de §12), debe renderizar un `textField` genérico como fallback.

### 14.5 Versión incompatible — protocolo de bloqueo

Cuando el estado es `error_contract_mismatch`:

1. El runtime **no intenta** renderizar UI dinámica con el descriptor incompatible.
2. El runtime **no elimina** el descriptor almacenado localmente; lo conserva para diagnóstico.
3. Se muestra al usuario un mensaje no omitible que indica que la versión de la aplicación no es compatible con el modelo activo y que debe actualizarse.
4. Las operaciones de edición local **no se encolan** mientras el runtime está en `error_contract_mismatch`; la cola offline permanece intacta pero bloqueada para nuevas entradas.
5. Si el runtime detecta que el servidor ofrece un descriptor con `descriptorContractVersion` compatible, puede intentar descargarlo y transicionar a `loading` → `ready`.
