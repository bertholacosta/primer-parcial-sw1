# Contrato del generador determinista — `generator-input-output` v1

- **Versión del contrato:** 1.0.0
- **Estado:** accepted
- **Fecha:** 2026-09-19
- **Autoridad:** Product Owner (ADR-0000, PROJECT.md)
- **Depende de:** `domain-model` v1 (`docs/contracts/domain-model-v1.md`)

---

## 1. Propósito y alcance

Este contrato define las entradas, configuración, salidas, manifiesto, semántica de errores y criterio de reproducibilidad del generador determinista de Spring Boot. Cubre la generación de las cinco capas obligatorias (Entity, DTO, Repository, Service, Controller) con persistencia JPA/Hibernate sobre PostgreSQL, a partir de un `domain-model.json` válido y conforme al contrato `domain-model` v1.

El contrato **no** elige lenguaje de implementación del generador, motor de plantillas ni versión concreta de Spring Boot o Hibernate. Esas decisiones requieren ADR aceptados separados. La invariante de reproducibilidad y las reglas de nombres son obligatorias independientemente de la implementación.

---

## 2. Versión e identidad del contrato

### 2.1 Campo de versión

Todo ejecutable o módulo generador debe declarar qué versión de este contrato implementa:

```
generatorContractVersion: "1"
```

Los consumidores del generador (pipeline Orca, CI) deben rechazar un generador que no declare o no coincida con la versión esperada.

### 2.2 Compatibilidad con `domain-model`

| Versión de este contrato | Versión de `domain-model` requerida |
|---|---|
| `"1"` | `"1"` |

El generador v1 solo acepta documentos `domain-model.json` con `contractVersion: "1"`. Un documento con `contractVersion` distinta produce el error `UNSUPPORTED_MODEL_CONTRACT_VERSION` y no genera código.

---

## 3. Entradas

### 3.1 Entrada primaria: modelo canónico

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `modelPath` | string (ruta) | sí | Ruta al fichero `domain-model.json` (o `*.domain-model.json`). El fichero debe ser legible y contener un documento JSON válido conforme al contrato `domain-model` v1. |

El generador ejecuta la validación del modelo canónico como primer paso, antes de cualquier generación. Si la validación produce al menos un diagnóstico de severidad `ERROR`, la generación se detiene con el error `INVALID_MODEL` y no produce salida alguna (invariante 2 de ARCHITECTURE.md).

### 3.2 Configuración de generación

La configuración es inmutable durante una ejecución. Toda variación de configuración se trata como una ejecución nueva independiente.

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `outputDir` | string (ruta) | sí | Directorio raíz donde se escribe el proyecto generado. Debe estar vacío o no existir antes de la generación; el generador no sobreescribe ejecuciones anteriores en el mismo directorio. |
| `basePackage` | string | sí | Paquete Java raíz del proyecto generado. Formato: identificador Java calificado (`com.example.app`). Los subpaquetes de cada capa se derivan de este valor según §6. |
| `artifactId` | string | sí | Identificador Maven del artefacto generado. Formato: `[a-z][a-z0-9-]*`. |
| `groupId` | string | sí | GroupId Maven. Formato: identificador Java calificado. |
| `generatorVersion` | string | sí | Versión del ejecutable del generador. Incluida en el manifiesto de salida para trazabilidad. Formato libre; semver recomendado. |
| `templateSetId` | string | sí | Identificador del conjunto de plantillas usado. Incluido en el manifiesto. Permite reproducibilidad exacta al fijar plantillas. |

### 3.3 Entradas adicionales (advertencia sobre herramientas externas)

El generador no acepta entradas de IA, voz, imagen ni colaboración en tiempo real como fuente directa de generación. Toda entrada externa debe haberse convertido al modelo canónico validado antes de llegar al generador (invariante 1 de ARCHITECTURE.md; ADR-0000).

---

## 4. Reproducibilidad y determinismo

### 4.1 Definición de reproducibilidad

Dos ejecuciones del generador son **reproducibles** si y solo si:

1. El `domain-model.json` de entrada es canónicamente igual (conforme a §4 del contrato `domain-model` v1: normalización de orden y representación JSON con separadores mínimos).
2. La configuración de generación (§3.2) es idéntica campo a campo.
3. El `templateSetId` y el contenido de las plantillas identificadas son idénticos.
4. La versión del generador (`generatorVersion`) es idéntica.

Bajo estas cuatro condiciones, la salida observable —conjunto de ficheros generados, sus contenidos y sus rutas relativas— es **byte a byte idéntica**.

### 4.2 Normalización canónica de la entrada

Antes de procesar, el generador debe normalizar el modelo de entrada al orden canónico definido en §4 de `domain-model` v1:

| Array | Ordenación |
|---|---|
| `packages` | `id` ASC |
| `classes` | `packageId` ASC (nulos primero), luego `id` ASC |
| `classes[*].attributes` | `id` ASC |
| `associations` | `sourceClassId` ASC, luego `id` ASC |

La normalización garantiza que dos documentos canónicamente iguales pero escritos en orden distinto produzcan la misma salida.

### 4.3 Fuentes prohibidas de no-determinismo

El generador no debe introducir las siguientes fuentes de variación entre ejecuciones equivalentes:

| Fuente | Prohibición |
|---|---|
| Fecha/hora del sistema | No se incluye en ningún contenido generado, salvo campos `createdAt`/`updatedAt` del modelo (que provienen del modelo, no del reloj del generador). |
| UUIDs generados en tiempo de ejecución | No se generan identificadores aleatorios durante la generación. |
| Orden de iteración no determinista | No se usan estructuras de datos con orden no garantizado (p. ej., `HashMap` sin orden) en la producción de salida. |
| Número de procesos/hilos | El resultado no puede depender de la concurrencia interna del generador. |
| Variables de entorno del sistema | No se leen variables de entorno en la lógica de generación de contenido; solo en la configuración explícita de §3.2. |

### 4.4 Verificación de reproducibilidad

El manifiesto de salida (§5.2) incluye un `sha256` por cada fichero generado. Para verificar reproducibilidad entre dos ejecuciones, es suficiente comparar los manifiestos: dos ejecuciones son reproducibles si los conjuntos de `{path, sha256}` son idénticos.

---

## 5. Salidas

### 5.1 Proyecto Spring Boot generado

La salida es un árbol de directorios con estructura Maven estándar. Para cada clase `C` del modelo, el generador produce exactamente los cinco artefactos siguientes (las cinco capas obligatorias):

| Capa | Artefacto (ruta relativa a `src/main/java/{basePackage}`) | Descripción |
|---|---|---|
| Entity | `{packagePath}/entity/{ClassName}Entity.java` | Entidad JPA con anotaciones `@Entity`, `@Table`, mapeos de atributos y relaciones. |
| DTO | `{packagePath}/dto/{ClassName}DTO.java` | Objeto de transferencia de datos sin anotaciones de persistencia. |
| Repository | `{packagePath}/repository/{ClassName}Repository.java` | Interfaz que extiende el repositorio JPA base. Sin lógica de negocio. |
| Service | `{packagePath}/service/{ClassName}Service.java` | Lógica de negocio y navegación de asociaciones. Usa el repositorio. |
| Controller | `{packagePath}/controller/{ClassName}Controller.java` | Controlador REST. Deriva rutas de `{ClassName}`. Sin lógica de negocio. |

Donde `{packagePath}` es la ruta de directorios correspondiente al paquete Java de la clase según §6.2, y `{ClassName}` sigue las reglas de §6.1.

No existe mecanismo en v1 para excluir ninguna clase de la generación de las cinco capas.

### 5.2 Manifiesto de generación (`generation-manifest.json`)

El generador produce un fichero `generation-manifest.json` en la raíz del `outputDir`. Este fichero es parte de la salida y está incluido en el cálculo de reproducibilidad.

```json
{
  "generatorContractVersion": "1",
  "generatorVersion": "<valor de configuración>",
  "templateSetId": "<valor de configuración>",
  "modelId": "<id del domain-model.json>",
  "modelVersion": "<version del domain-model.json>",
  "modelContractVersion": "1",
  "modelSha256": "<sha256 del domain-model.json normalizado>",
  "basePackage": "<valor de configuración>",
  "artifactId": "<valor de configuración>",
  "groupId": "<valor de configuración>",
  "files": [
    {
      "path": "src/main/java/com/example/biblioteca/entity/LibroEntity.java",
      "sha256": "<hash del fichero generado>"
    }
  ]
}
```

**Invariantes del manifiesto:**

- `generatorContractVersion` siempre es `"1"`.
- `generatorVersion` es la versión semántica de la herramienta generadora.
- `modelId` y `modelVersion` permiten trazar el proyecto generado al documento de modelo exacto.
- `modelSha256` es el hash SHA-256 del documento `domain-model.json` serializado en orden canónico con separadores mínimos (UTF-8).
- El array `files` contiene una entrada por cada fichero generado. El propio `generation-manifest.json` está excluido de este array para evitar una dependencia circular con su propio hash.
- El array `files` está ordenado por `path` ASC para determinismo.

### 5.3 Descriptor Flutter

El generador también produce el descriptor Flutter (`flutter-descriptor.json`) en la raíz del `outputDir`. Su estructura y contrato están definidos en `docs/contracts/flutter-descriptor-v1.md`. El manifiesto incluye una entrada para este fichero en el array `files`.

---

## 6. Reglas de nombres

Las reglas de nombres son deterministas: dado el modelo canónico y la configuración, los nombres de ficheros, clases Java, paquetes y rutas REST son únicos y predecibles. No dependen de ninguna heurística ni estado externo.

### 6.1 Nombre de clase Java (`{ClassName}`)

El nombre de la clase Java se deriva del campo `name` de la clase del modelo aplicando las siguientes transformaciones en orden:

1. **UpperCamelCase:** convertir el primer carácter a mayúscula; convertir a mayúscula el carácter inmediatamente posterior a `_` o `-`; eliminar `_` y `-`.
2. **Desambiguación de paquete:** si dos clases de paquetes distintos producen el mismo `{ClassName}` (colisión), cada una incorpora el nombre de su paquete inmediato como prefijo: `{PackageName}{ClassName}`.

Ejemplos:

| `name` en modelo | `{ClassName}` resultante |
|---|---|
| `libro` | `Libro` |
| `autor_secundario` | `AutorSecundario` |
| `line-item` | `LineItem` |

### 6.2 Paquete Java (`{packagePath}`)

El paquete Java de una clase se construye concatenando:

```
{basePackage}.{packageName1}.{packageName2}...
```

Donde `{packageName1}`, `{packageName2}`, … son los nombres de los paquetes del modelo en orden jerárquico desde la raíz hasta el paquete inmediato de la clase, convertidos a minúsculas. Si una clase no tiene `packageId`, se usa solo `{basePackage}`.

### 6.3 Nombre de atributo Java

El campo `name` del atributo del modelo se convierte a lowerCamelCase:

1. Primer carácter en minúscula.
2. Carácter posterior a `_` o `-` en mayúscula; eliminar `_` y `-`.

### 6.4 Ruta REST (`{RestPath}`)

La ruta REST de un controlador se deriva del `{ClassName}` de la clase:

```
/{className-en-kebab-case}s
```

Donde `{className-en-kebab-case}` es el `{ClassName}` convertido a minúsculas separando palabras con `-`. El sufijo `s` indica colección REST.

Ejemplos:

| `{ClassName}` | Ruta REST |
|---|---|
| `Libro` | `/libros` |
| `AutorSecundario` | `/autor-secundarios` |
| `LineItem` | `/line-items` |

### 6.5 Reglas JPA/Hibernate

| Elemento | Regla de nombre |
|---|---|
| Nombre de tabla (`@Table`) | `{class.name}` convertido a `snake_case` en minúsculas. |
| Nombre de columna (`@Column`) | `{attribute.name}` convertido a `snake_case` en minúsculas. |
| Nombre de columna de FK | `{associationName}_id` donde `associationName` es el `name` de la asociación en `snake_case`; si la asociación no tiene `name`, se usa `{targetClassName}_id` en `snake_case`. |
| Nombre de tabla de unión (M:N) | Concatenación alfabética de las dos tablas participantes separadas por `_`. |

Todas las entidades generadas se anotan con `@Entity` y `@Table`. Los atributos `nullable: false` con `multiplicity: "1"` reciben `@Column(nullable = false)`. La clave primaria se genera como campo `id` de tipo `Long` con estrategia `IDENTITY`, salvo que el modelo incluya explícitamente un atributo llamado `id` de tipo `Long` o `UUID` en la clase.

---

## 7. Mapeo de tipos del modelo a Java/JPA

| Tipo `domain-model` v1 | Tipo Java | Anotación JPA adicional |
|---|---|---|
| `String` | `String` | `@Column(columnDefinition = "TEXT")` (por defecto) |
| `Integer` | `Integer` | — |
| `Long` | `Long` | — |
| `Double` | `Double` | — |
| `Boolean` | `Boolean` | — |
| `Date` | `java.time.LocalDate` | — |
| `DateTime` | `java.time.LocalDateTime` | — |
| `UUID` | `java.util.UUID` | `@Column(columnDefinition = "uuid")` (PostgreSQL) |

---

## 8. Mapeo de asociaciones a JPA

| `sourceMultiplicity` | `targetMultiplicity` | Anotación en Entity origen | Anotación en Entity destino (si `bidirectional`) |
|---|---|---|---|
| `1` o `0..1` | `1` o `0..1` | `@OneToOne` | `@OneToOne(mappedBy=...)` |
| `0..*` o `1..*` | `1` o `0..1` | `@ManyToOne` | `@OneToMany(mappedBy=...)` |
| `1` o `0..1` | `0..*` o `1..*` | `@OneToMany` (con `@JoinColumn`) | `@ManyToOne` |
| `0..*` o `1..*` | `0..*` o `1..*` | `@ManyToMany` (con `@JoinTable`) | `@ManyToMany(mappedBy=...)` |

Las asociaciones `unidirectional` no generan campo en la entidad destino.

---

## 9. Semántica de errores

### 9.1 Principio de atomicidad

La generación es atómica: o produce la totalidad de artefactos definidos en §5, o no produce ninguno. No existe estado intermedio aceptable (parcialmente generado). Si se produce cualquier error durante la generación, el generador debe:

1. Detener toda escritura inmediatamente.
2. Revertir o eliminar los ficheros parcialmente escritos en `outputDir`.
3. Emitir la lista completa de diagnósticos recogidos hasta el momento del error (§9.2).
4. Retornar un código de salida no cero.

### 9.2 Catálogo de errores del generador

| Código | Fase | Descripción | Severidad |
|---|---|---|---|
| `INVALID_MODEL` | Validación previa | El modelo tiene al menos un diagnóstico `ERROR` del contrato `domain-model` v1. El campo `diagnostics` del informe de error incluye los diagnósticos del validador. | `ERROR` |
| `UNSUPPORTED_MODEL_CONTRACT_VERSION` | Validación previa | `contractVersion` del modelo no es `"1"`. | `ERROR` |
| `MODEL_NOT_FOUND` | Entrada | El fichero indicado en `modelPath` no existe o no es legible. | `ERROR` |
| `MODEL_NOT_VALID_JSON` | Entrada | El fichero no puede parsearse como JSON. | `ERROR` |
| `OUTPUT_DIR_NOT_EMPTY` | Configuración | `outputDir` ya contiene ficheros. | `ERROR` |
| `INVALID_BASE_PACKAGE` | Configuración | `basePackage` no es un identificador Java calificado válido. | `ERROR` |
| `INVALID_ARTIFACT_ID` | Configuración | `artifactId` no sigue el patrón `[a-z][a-z0-9-]*`. | `ERROR` |
| `TEMPLATE_SET_NOT_FOUND` | Configuración | El `templateSetId` no corresponde a ningún conjunto de plantillas conocido. | `ERROR` |
| `NAME_COLLISION` | Generación | Dos clases de paquetes distintos producen el mismo nombre de clase Java tras aplicar §6.1 y la regla de prefijo de paquete no resuelve la colisión. | `ERROR` |
| `IO_ERROR` | Escritura | Error de escritura en `outputDir`. | `ERROR` |

### 9.3 Formato del informe de error

Cuando el generador termina con error, emite un informe JSON en `stderr` (o en un fichero `generation-error.json` en el directorio de trabajo):

```json
{
  "generatorContractVersion": "1",
  "outcome": "failed",
  "errors": [
    {
      "code": "<código de §9.2>",
      "message": "<descripción legible>",
      "diagnostics": [ "<diagnósticos del validador, si aplica>" ]
    }
  ]
}
```

---

## 10. Invariantes del contrato

| # | Invariante |
|---|---|
| I1 | Toda clase del modelo produce exactamente cinco artefactos de capa. |
| I2 | Una entrada inválida no produce ningún artefacto. |
| I3 | Misma entrada canónica + misma configuración + mismas plantillas = misma salida byte a byte. |
| I4 | El manifiesto vincula cada ejecución a un `modelId`, `modelVersion` y `modelSha256` exactos. |
| I5 | Las reglas de nombres son deterministas y no dependen de estado externo. |
| I6 | PostgreSQL se accede mediante JPA/Hibernate; no se generan sentencias SQL directas en las capas de negocio. |
| I7 | Las responsabilidades de las cinco capas no se fusionan entre sí. |
| I8 | El generador no lee variables de entorno en la lógica de contenido generado. |

---

## 11. Ejemplos normativos

### 11.1 Entrada mínima válida

Dado el modelo `valid-minimal.domain-model.json` (clase `Libro` con atributos `titulo: String`, `isbn: String`) y la configuración:

```json
{
  "modelPath": "fixtures/models/valid-minimal.json",
  "outputDir": "out/biblioteca",
  "basePackage": "com.example.biblioteca",
  "artifactId": "biblioteca",
  "groupId": "com.example",
  "generatorVersion": "1.0.0",
  "templateSetId": "spring-boot-jpa-v1"
}
```

El generador produce:

```
out/biblioteca/
  generation-manifest.json
  flutter-descriptor.json
  src/main/java/com/example/biblioteca/
    entity/LibroEntity.java
    dto/LibroDTO.java
    repository/LibroRepository.java
    service/LibroService.java
    controller/LibroController.java
  ...
```

El controlador `LibroController` expone la ruta REST `/libros`.

### 11.2 Entrada inválida — sin salida

Dado un `domain-model.json` con un diagnóstico `ERROR` (p. ej., `UNKNOWN_TYPE`), el generador:

- No escribe ningún fichero en `outputDir`.
- Emite `generation-error.json` con `outcome: "failed"` y `code: "INVALID_MODEL"`.
- Retorna código de salida `1`.

### 11.3 Reproducibilidad verificable

Dos ejecuciones con idénticos `modelPath` (canónicamente igual), `templateSetId` y demás configuración producen un manifiesto idéntico byte a byte.

---

## 12. Compatibilidad y migración

### 12.1 Cambios compatibles (nueva versión menor de este documento)

- Añadir reglas de nombre opcionales para elementos no cubiertos en v1.
- Añadir entradas de configuración opcionales con valores por defecto.
- Ampliar el catálogo de errores con nuevos códigos.
- Añadir campos opcionales al manifiesto.

### 12.2 Cambios incompatibles (requieren `generatorContractVersion: "2"` y ADR aceptado)

- Cambiar la semántica de cualquier campo obligatorio de la configuración.
- Modificar las reglas de nombres de §6 de forma que alteren la salida existente.
- Cambiar el mapeo de tipos de §7.
- Modificar la estructura del manifiesto de forma incompatible.
- Cambiar el modelo de errores atómicos de §9.

### 12.3 Coexistencia de versiones

Un pipeline puede ejecutar generadores v1 y v2 simultáneamente sobre modelos distintos. Cada generador declara su `generatorContractVersion` y acepta solo los `domain-model` compatibles según §2.2.

---

## 13. Decisiones cerradas, supuestos y preguntas abiertas

### 13.1 Decisiones cerradas

| # | Decisión | Fuente |
|---|---|---|
| D1 | Cinco capas obligatorias: Entity, DTO, Repository, Service, Controller. | PROJECT.md, ADR-0000, ARCHITECTURE.md invariante 5 |
| D2 | Persistencia mediante JPA/Hibernate sobre PostgreSQL. | PROJECT.md, ARCHITECTURE.md invariante 6 |
| D3 | Reproducibilidad byte a byte bajo condiciones de §4.1. | ADR-0000, ARCHITECTURE.md invariante 3 |
| D4 | Atomicidad: entrada inválida → ninguna salida. | ARCHITECTURE.md invariante 2 |
| D5 | Manifiesto obligatorio con trazabilidad al modelo. | ARCHITECTURE.md invariante 4 |
| D6 | No se elige motor de plantillas en este contrato. | Tarea P2-001, ADR-0002 pendiente |
| D7 | Normalización canónica de entrada antes de generar. | §4 de `domain-model` v1 |

### 13.2 Supuestos registrados

| # | Supuesto | Consecuencia si es incorrecto |
|---|---|---|
| S1 | La clave primaria de toda entidad es un `Long id` generado con `IDENTITY`, salvo que el modelo declare explícitamente un atributo `id`. | Si el dominio requiere claves compuestas, se necesita extensión del contrato. |
| S2 | No se generan migraciones de base de datos (Flyway/Liquibase) en v1. | Si CI requiere migraciones, se necesita una tarea de especificación adicional. |
| S3 | No se generan pruebas unitarias ni de integración en v1. | Si el PO lo requiere, se añade como tarea separada con su contrato. |
| S4 | El descriptor Flutter se produce en la misma ejecución del generador. | Si se separan ejecuciones, se necesita coordinar el `modelSha256` del manifiesto. |

### 13.3 Preguntas abiertas que requieren aprobación del Product Owner

| # | Pregunta | Impacto |
|---|---|---|
| Q1 | ¿El `templateSetId` se resuelve como una ruta local o como un identificador de registro remoto? | Afecta a la reproducibilidad en entornos diferentes. |
| Q2 | ¿Se generan anotaciones de validación Bean Validation (`@NotNull`, `@Size`) además de JPA? | Afecta al contenido de Entity y DTO. |
| Q3 | ¿La clave primaria de UUID se genera como `@GeneratedValue(strategy = AUTO)` o como `@UuidGenerator`? | Depende de la versión de Hibernate elegida (ADR-0002 pendiente). |
| Q4 | ¿Debe el generador fallar si `outputDir` existe pero está vacío, o solo si contiene ficheros? | Afecta a la semántica del error `OUTPUT_DIR_NOT_EMPTY`. |

