# Contrato de semántica offline móvil — `mobile-offline` v1

- **Versión del contrato:** 1.0.0
- **Estado:** accepted
- **Fecha:** 2026-09-20
- **Autoridad:** Product Owner (ADR-0000, PROJECT.md)
- **Depende de:** `flutter-descriptor` v1 (`docs/contracts/flutter-descriptor-v1.md`), `domain-model` v1 (`docs/contracts/domain-model-v1.md`)
- **Relacionado con:** ADR-0004 (`docs/adr/0004-mobile-state-and-storage.md`)

---

## 1. Propósito y alcance

Este contrato define la semántica de operación offline de la aplicación móvil Flutter: cómo se persisten localmente el descriptor y los datos del usuario, cómo se identifican las operaciones pendientes, cómo se reintenta su envío al servidor y cómo se garantiza idempotencia. Define también los límites de la resolución de conflictos que el runtime móvil puede manejar sin intervención del servidor o del usuario.

Este contrato **no** elige librería de persistencia local, motor de base de datos embebido, framework de estado Flutter ni mecanismo de transporte de red. Esas decisiones requieren ADR-0004 aceptado (actualmente en estado `proposed`). El contrato describe semántica observable, no implementación.

---

## 2. Modelo de persistencia local

### 2.1 Artefactos persistidos localmente

El runtime móvil persiste los siguientes artefactos de forma durable en el dispositivo:

| Artefacto | Descripción | Inmutabilidad |
|---|---|---|
| **Snapshot del descriptor** | Copia local del `flutter-descriptor.json` más reciente verificado. | Solo lectura en runtime; se reemplaza por descarga verificada. |
| **Datos de instancia** | Registros de entidades creados o editados en el dispositivo que aún no han sido confirmados por el servidor. | Mutables hasta confirmación del servidor. |
| **Cola offline** | Lista ordenada de operaciones pendientes de envío al servidor. | Append-only hasta que el servidor confirma cada operación. |
| **Registro de confirmaciones** | Historial de operaciones confirmadas por el servidor, con su `operationId` y resultado. Permite deduplicación. | Inmutable tras escritura. |

### 2.2 Persistencia del descriptor

1. El snapshot del descriptor se persiste completo, sin fragmentar, junto con su `sourceModelSha256`.
2. El descriptor almacenado no se modifica en runtime; es de solo lectura (invariante I2 de `flutter-descriptor` v1).
3. Cuando el runtime descarga un nuevo descriptor, lo valida completamente (contrato, campos obligatorios, SHA256) antes de reemplazar el snapshot local. Si la validación falla, el snapshot anterior se conserva intacto.
4. El snapshot almacenado incluye el campo `descriptorContractVersion` para permitir detección de incompatibilidad sin acceso a red.

### 2.3 Persistencia de datos de instancia

1. Los datos de instancia son registros del dominio modelado (filas lógicas de entidades del descriptor).
2. Cada registro local se identifica mediante un `localId` (ver §3.1).
3. Un registro local puede tener un `remoteId` asociado si ya fue confirmado por el servidor.
4. Los registros locales no confirmados conviven con los registros sincronizados. El runtime los distingue por estado (ver §3.3).
5. El runtime no aplica migraciones de esquema de datos de instancia de forma autónoma; si el descriptor cambia y los datos locales son incompatibles con el nuevo esquema, el runtime transiciona al estado `stale` y bloquea nuevas ediciones hasta resolución explícita.

---

## 3. Identidad de operación

### 3.1 Identidad local (`localId`)

Cada registro creado en el dispositivo recibe un `localId` generado localmente antes de enviarlo al servidor. El `localId` cumple las siguientes propiedades:

| Propiedad | Requisito |
|---|---|
| **Unicidad local** | Único en el dispositivo en el tiempo de vida de la instalación. |
| **Generación offline** | Se genera sin acceso a red ni coordinación con el servidor. |
| **Estabilidad** | No cambia tras la confirmación del servidor; se conserva como clave de correlación. |
| **Formato** | UUID v4 generado por el runtime móvil. |

El `localId` no es el identificador definitivo del recurso en el servidor. Tras la confirmación, el servidor asigna un `remoteId`; el runtime almacena la correlación `localId → remoteId`.

### 3.2 Identidad de operación (`operationId`)

Cada operación encolada (create, update, delete) tiene un `operationId` único e inmutable que identifica esa operación específica, independientemente del número de reintentos.

| Campo | Tipo | Descripción |
|---|---|---|
| `operationId` | UUID v4 | Generado en el momento de encolar la operación. Inmutable. |
| `operationType` | string | Uno de: `create`, `update`, `delete`. |
| `entityClassId` | string | `id` de la clase en el descriptor (trazabilidad al modelo). |
| `localId` | string | `localId` del registro afectado. |
| `remoteId` | string \| null | `remoteId` del registro si ya fue asignado por el servidor. Nulo en operaciones `create` no confirmadas. |
| `payload` | object | Datos de la operación en el momento de encolamiento. Inmutable tras encolamiento. |
| `enqueuedAt` | string | Timestamp ISO 8601 del momento de encolamiento. |
| `attemptCount` | integer | Número de intentos de envío realizados. Inicialmente `0`. |
| `lastAttemptAt` | string \| null | Timestamp del último intento. Nulo si no se ha intentado aún. |
| `status` | string | Ver §3.3. |

### 3.3 Estados de una operación encolada

| Estado | Descripción | Transiciones posibles |
|---|---|---|
| `pending` | En cola, no enviada aún. | → `in_flight`, → `cancelled` |
| `in_flight` | Enviada, esperando respuesta del servidor. | → `confirmed`, → `failed_retryable`, → `failed_permanent` |
| `confirmed` | El servidor confirmó la operación con éxito. Estado terminal. | — |
| `failed_retryable` | El servidor devolvió un error transitorio o se agotó el tiempo de espera. Se reintentará. | → `pending` (tras backoff) |
| `failed_permanent` | El servidor rechazó la operación de forma definitiva (conflicto irresolvable, recurso eliminado, etc.). Estado terminal. | → `cancelled` (acción manual) |
| `cancelled` | Cancelada por el usuario o por el runtime (tras superar el límite de reintentos). Estado terminal. | — |

---

## 4. Cola offline

### 4.1 Semántica de la cola

1. La cola offline es una estructura **append-only ordenada** por `enqueuedAt`. Las operaciones se procesan en orden FIFO dentro de cada entidad; operaciones sobre entidades distintas pueden enviarse en paralelo (ver §4.3).
2. Las operaciones se encolan de forma síncrona en el dispositivo. El encolamiento es exitoso si y solo si la operación queda registrada en el almacenamiento local durable antes de retornar al llamador.
3. Una operación encolada no se descarta hasta que alcanza un estado terminal (`confirmed`, `failed_permanent`, `cancelled`).
4. El runtime no agrupa (batch) operaciones automáticamente; cada operación se envía de forma independiente para preservar idempotencia individualizable.

### 4.2 Condiciones de encolamiento

Una operación se encola si y solo si:

- El runtime está en estado `ready`, `stale` o `unavailable` (§14.2 de `flutter-descriptor` v1).
- El descriptor local está presente y la `entityClassId` referencia una clase conocida en el descriptor.
- Los datos del `payload` superan las validaciones mínimas del `uiType` correspondiente (§14.4 de `flutter-descriptor` v1).

Una operación **no** se encola si:

- El runtime está en estado `error_contract_mismatch` o `error_missing_field`.
- El `payload` está vacío para una operación `create` o `update`.

### 4.3 Orden de envío y dependencias entre operaciones

| Caso | Regla de orden |
|---|---|
| Dos operaciones sobre el mismo `localId` | Enviadas estrictamente en orden FIFO. |
| Una operación `update` o `delete` sobre un `localId` cuyo `create` no fue confirmado | La operación `update`/`delete` espera hasta que el `create` sea `confirmed` y el `remoteId` esté disponible. |
| Operaciones sobre `localId` distintos y sin dependencias de referencia | Pueden enviarse en paralelo. |
| Operación referenciando un `localId` de otra entidad (clave foránea local) | Espera a que la operación `create` de la entidad referenciada esté `confirmed`. |

### 4.4 Límite de tamaño de la cola

| Parámetro | Valor por defecto | Ajustable |
|---|---|---|
| Máximo de operaciones pendientes simultáneas | 500 | Sí, por configuración de la app |
| Máximo de operaciones en estado `in_flight` en paralelo | 10 | Sí, por configuración de la app |

Si la cola alcanza el máximo de operaciones pendientes, el runtime bloquea nuevas ediciones y notifica al usuario. Las ediciones en progreso no se descartan.

---

## 5. Reintento

### 5.1 Política de reintento

El runtime aplica reintento con **backoff exponencial con jitter** para las operaciones en estado `failed_retryable`. La política no depende de librería concreta; describe la semántica observable.

| Parámetro | Valor por defecto |
|---|---|
| Espera inicial entre reintentos | 2 segundos |
| Factor de crecimiento exponencial | 2× |
| Jitter | Aleatorio uniforme en ±25 % del intervalo calculado |
| Espera máxima entre reintentos | 5 minutos |
| Máximo de reintentos por operación | 10 |

Tras superar el máximo de reintentos, la operación transiciona a `failed_permanent`.

### 5.2 Condiciones de reintentabilidad

Una operación es reintentable (`failed_retryable`) si el error es transitorio:

| Tipo de error | Reintentable |
|---|---|
| Timeout de red | Sí |
| Error HTTP 5xx del servidor | Sí |
| Pérdida de conectividad | Sí |
| Error HTTP 4xx del servidor (400, 422) | No (`failed_permanent`) |
| Error HTTP 409 Conflict irresolvable | No (`failed_permanent`) |
| Error HTTP 404 (recurso eliminado en servidor) | No (`failed_permanent`) |
| Error de validación del servidor (negocio) | No (`failed_permanent`) |

### 5.3 Reactivación de la cola tras conectividad

Cuando el runtime detecta recuperación de conectividad (transición desde `unavailable` o `stale` con red restablecida), reintenta automáticamente todas las operaciones en estado `pending` comenzando por las más antiguas según `enqueuedAt`.

---

## 6. Idempotencia

### 6.1 Garantía de idempotencia del cliente

El runtime garantiza que una misma operación lógica (identificada por `operationId`) no se encola más de una vez, incluso si el usuario realiza la misma acción UI repetidamente en un intervalo corto.

Para operaciones `create`: si el usuario intenta crear un registro mientras existe una operación `create` pendiente o `in_flight` con el mismo contenido sobre la misma clase, el runtime bloquea la segunda creación y notifica al usuario.

Para operaciones `update`: las operaciones `update` sobre el mismo `localId` se coalescen si la operación anterior aún no ha sido enviada (`pending`). La coalescencia reemplaza el `payload` de la operación existente con el nuevo valor y actualiza `enqueuedAt`. El `operationId` original se conserva.

### 6.2 Garantía de idempotencia en el envío

El runtime envía el `operationId` como parte de cada petición al servidor (como cabecera `Idempotency-Key` o campo de cuerpo, según acuerdo con el servidor). El servidor es responsable de garantizar que múltiples envíos del mismo `operationId` producen el mismo efecto que uno solo.

Si el servidor confirma una operación ya confirmada (respuesta 2xx), el runtime trata la respuesta como éxito sin duplicar el efecto.

### 6.3 Registro de deduplicación

El registro de confirmaciones (§2.1) almacena los `operationId` confirmados. Antes de enviar una operación, el runtime verifica que el `operationId` no esté ya en el registro de confirmaciones. Si está presente, la operación se marca `confirmed` sin reenvío.

---

## 7. Límites de conflicto

### 7.1 Definición de conflicto

Un **conflicto** ocurre cuando el servidor rechaza o modifica el resultado de una operación por divergencia entre el estado local del cliente y el estado actual del servidor.

El runtime móvil distingue dos categorías:

| Categoría | Descripción | Resolución |
|---|---|---|
| **Conflicto resolvable localmente** | El servidor acepta la operación pero devuelve un estado diferente al esperado (p.ej., campo calculado distinto). El runtime actualiza el registro local con la respuesta del servidor. | Automática; sin intervención del usuario. |
| **Conflicto irresolvable** | El servidor rechaza la operación de forma definitiva (conflicto de versión, recurso eliminado, violación de regla de negocio). La operación transiciona a `failed_permanent`. | Requiere intervención del usuario. |

### 7.2 Límites de responsabilidad del runtime móvil

El runtime móvil **puede** resolver de forma autónoma:

- Actualizar el `remoteId` de un registro local tras confirmación del `create`.
- Reemplazar datos locales de un registro con la respuesta del servidor tras un `update` exitoso.
- Marcar un registro local como eliminado tras confirmación del `delete`.
- Descartar una operación `update` o `delete` si la operación `create` del mismo registro fue `failed_permanent` (el recurso nunca existió en el servidor).

El runtime móvil **no puede** resolver de forma autónoma:

- Dos operaciones `create` concurrentes sobre la misma entidad con el mismo identificador de negocio (p.ej., ISBN duplicado).
- Una operación `update` cuyo campo de versión (`ETag`, número de versión, timestamp) diverge del servidor.
- Una operación `delete` sobre un recurso que ya fue eliminado por otro cliente.
- Cualquier conflicto que requiera fusión semántica de datos (merge) entre versiones divergentes.

### 7.3 Presentación de conflictos irresolvables al usuario

Cuando una operación alcanza `failed_permanent` por conflicto irresolvable:

1. El runtime notifica al usuario con el detalle del error devuelto por el servidor.
2. El registro local afectado se marca como `conflicted` (campo adicional de estado de UI, no parte del modelo de dominio).
3. El usuario puede elegir: (a) descartar los cambios locales y aceptar el estado del servidor, o (b) reencolar la operación con datos corregidos manualmente.
4. El runtime no aplica resolución automática de conflictos basada en timestamp ("last-write-wins") sin consentimiento explícito del usuario.

### 7.4 Límite de antigüedad de operaciones pendientes

| Parámetro | Valor por defecto |
|---|---|
| Tiempo máximo de una operación en estado `pending` | 72 horas |

Tras superar el límite de antigüedad sin poder enviarse, la operación transiciona a `failed_permanent` con código `OPERATION_EXPIRED`. El usuario es notificado y puede decidir reencolarla con datos frescos.

---

## 8. Sincronización del descriptor

### 8.1 Condiciones de descarga del descriptor

El runtime intenta descargar un descriptor actualizado cuando:

1. Se restablece la conectividad desde el estado `unavailable`.
2. El servidor notifica (por push o polling) que el modelo activo cambió (nuevo `sourceModelSha256`).
3. El usuario solicita explícitamente una sincronización.
4. Al inicio de sesión si el snapshot local tiene más de un umbral configurable de antigüedad (por defecto: 24 horas).

### 8.2 Verificación antes de reemplazar

Antes de reemplazar el snapshot local, el runtime verifica:

1. `descriptorContractVersion` coincide con la versión soportada por el runtime.
2. Todos los campos obligatorios del documento raíz están presentes.
3. `sourceModelSha256` es coherente con el contenido declarado del descriptor.

Si cualquiera de estas verificaciones falla, el descriptor descargado se descarta y el snapshot anterior se conserva.

### 8.3 Relación con la cola offline

La descarga de un nuevo descriptor no cancela ni modifica las operaciones pendientes en la cola. Las operaciones encoladas se enviaron contra una versión del descriptor; si el nuevo descriptor cambia la estructura de la clase afectada:

1. El runtime transiciona al estado `stale` para las operaciones cuya `entityClassId` corresponde a una clase que cambió en el nuevo descriptor.
2. El usuario es notificado de las operaciones que podrían ser incompatibles.
3. Las operaciones en estado `in_flight` no se interrumpen.

---

## 9. Invariantes del contrato

| # | Invariante |
|---|---|
| I1 | Toda operación encolada tiene un `operationId` único e inmutable; nunca se reutiliza ni se modifica. |
| I2 | El `localId` de un registro no cambia tras la confirmación del servidor; la correlación `localId → remoteId` se conserva. |
| I3 | El `payload` de una operación es inmutable desde el momento de encolamiento, salvo coalescencia de `update` pendiente (§6.1). |
| I4 | El snapshot del descriptor almacenado localmente no se modifica en runtime; solo se reemplaza por un descriptor nuevo verificado. |
| I5 | Una operación en estado terminal (`confirmed`, `failed_permanent`, `cancelled`) no vuelve a estados no terminales. |
| I6 | El registro de confirmaciones es append-only; una entrada confirmada nunca se elimina ni modifica. |
| I7 | El runtime no aplica resolución automática de conflictos semánticos sin consentimiento explícito del usuario. |
| I8 | Este contrato no elige librería, motor de base de datos embebido ni framework de estado; describe semántica observable. |

---

## 10. Semántica de errores offline

| Código | Descripción | Acción recomendada |
|---|---|---|
| `QUEUE_FULL` | La cola alcanzó el límite de operaciones pendientes (§4.4). | Notificar al usuario; bloquear nuevas ediciones hasta que se procesen operaciones pendientes. |
| `ENQUEUE_REJECTED_STATE` | Intento de encolar una operación en un estado de runtime que no lo permite (§4.2). | Informar al usuario del estado actual. |
| `OPERATION_EXPIRED` | Una operación superó el límite de antigüedad (§7.4). | Marcar `failed_permanent`; notificar al usuario. |
| `DESCRIPTOR_UNAVAILABLE` | No hay snapshot local del descriptor y no hay conectividad. | Usar renderizado mínimo de emergencia (§14.4 de `flutter-descriptor` v1). |
| `CONFLICT_UNRESOLVABLE` | El servidor rechazó la operación de forma irresolvable (§7.2). | Marcar `failed_permanent`; presentar opciones de resolución al usuario (§7.3). |
| `IDEMPOTENCY_DUPLICATE` | El `operationId` ya está en el registro de confirmaciones. | Marcar `confirmed` sin reenvío; no duplicar efecto. |

---

## 11. Decisiones cerradas, supuestos y preguntas abiertas

### 11.1 Decisiones cerradas

| # | Decisión | Fuente |
|---|---|---|
| D1 | No se elige librería de persistencia local en v1; el contrato describe semántica observable. | ADR-0004 (proposed); tarea P3-001. |
| D2 | El `operationId` se usa como clave de idempotencia; el servidor es responsable de garantizar el efecto idempotente. | §6.2 de este contrato. |
| D3 | El runtime no aplica last-write-wins automático; los conflictos irresolvables requieren acción del usuario. | §7.3 de este contrato. |
| D4 | La cola offline es append-only; las operaciones no se eliminan hasta estado terminal. | §4.1 de este contrato. |
| D5 | El `localId` es un UUID v4 generado localmente; no depende de coordinación con el servidor. | §3.1 de este contrato. |

### 11.2 Supuestos registrados

| # | Supuesto | Consecuencia si es incorrecto |
|---|---|---|
| S1 | El servidor acepta el `operationId` como clave de idempotencia (cabecera o campo de cuerpo). | Si el servidor no soporta idempotencia, el runtime no puede garantizar la semántica de §6.2. |
| S2 | El almacenamiento local es durable ante reinicios de app y del dispositivo. | Si la persistencia no es durable, las garantías de §4.1 no se cumplen. |
| S3 | El servidor devuelve el `remoteId` asignado al recurso en la respuesta de confirmación del `create`. | Si el servidor no devuelve el `remoteId`, la correlación `localId → remoteId` no puede establecerse. |
| S4 | Las operaciones `delete` son idempotentes en el servidor (eliminar un recurso ya eliminado devuelve 200/204, no 404 bloqueante). | Si el servidor devuelve 404 para un `delete` de recurso ya eliminado, el runtime debe tratarlo como `confirmed`, no `failed_permanent`. |
| S5 | El número máximo de 500 operaciones pendientes es suficiente para los casos de uso del parcial. | Si el dominio requiere más, el límite configurable debe ajustarse. |

### 11.3 Preguntas abiertas que requieren aprobación del Product Owner

| # | Pregunta | Impacto |
|---|---|---|
| Q1 | ¿Qué mecanismo usa el servidor para notificar al cliente que el modelo cambió (push vs polling)? | Afecta a §8.1 y a ADR-0004. |
| Q2 | ¿El campo de versión de recurso (para detección de conflictos en `update`) es un ETag HTTP, un número de versión, o un timestamp? | Afecta a §7.2 y al protocolo de envío de operaciones. |
| Q3 | ¿El runtime debe sincronizar también los datos de instancia del servidor (no solo el descriptor) durante la reconexión? | Si sí, se necesita un contrato de sincronización de datos separado. |
| Q4 | ¿El límite de 72 horas para `OPERATION_EXPIRED` es configurable por el servidor o solo por la app? | Afecta a la arquitectura de configuración remota. |
| Q5 | ¿Los conflictos resolvables localmente (§7.1) requieren registro de auditoría en el servidor? | Si sí, el servidor debe exponer un endpoint de reconciliación. |

---

## 12. Política de cambios al contrato

1. **Cambio compatible (nueva versión menor del documento):** añadir campos opcionales a la estructura de la cola, ampliar tablas de errores, relajar límites numéricos. Requiere actualizar este documento; no requiere ADR.
2. **Cambio incompatible (nueva versión del contrato):** cambiar la semántica de `operationId`, `localId`, estados de operación, o política de idempotencia. Requiere ADR aceptado por el Product Owner y nuevo documento `mobile-offline-v2.md`.
3. La implementación concreta (librería, motor de BD, framework de estado) se decide en ADR-0004 y no invalida este contrato.
