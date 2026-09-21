# ADR-0003: colaboración en tiempo real

- **Estado:** `accepted`
- **Decisor:** Product Owner
- **Fecha:** 2026-09-20
- **Autor:** Kiro / Antigravity (tarea P6-002)
- **Relacionado con:** `docs/contracts/collaboration-protocol-v1.md`, `docs/contracts/model-commands-v1.md`, `docs/contracts/mobile-offline-v1.md`, `packages/collaboration-protocol/README.md`

---

## 1. Pregunta

¿Qué modelo de consistencia, modelo de transporte y persistencia sincronizarán comandos concurrentes garantizando las invariantes de convergencia, operación offline y el cumplimiento estricto del protocolo `collaboration-protocol-v1.md`?

---

## 2. Contexto y restricciones

El contrato normativo `collaboration-protocol-v1.md` (aceptado) y el catálogo de comandos `model-commands-v1.md` (aceptado) fijan los requisitos canónicos para la sincronización de modelos entre múltiples clientes concurrentes (editor CASE web, aplicaciones móviles y adaptadores externos). Las restricciones clave que gobiernan esta decisión son:

1. **Ordenación y causalidad:** Se requiere orden total observable mediante secuencia monótona (`serverSeqNumber`) para garantizar consistencia eventual fuerte (Strong Eventual Consistency, SEC).
2. **Control de concurrencia optimista:** Según `model-commands-v1.md` §2.1 y `collaboration-protocol-v1.md` §6.1, cualquier comando emitido sobre una versión desactualizada (`modelVersion`) debe ser rechazado con el error determinista `CONCURRENT_MODIFICATION`. No se permiten reescrituras silenciosas ni mutaciones parciales de estado.
3. **Idempotencia acotada y vinculada:** Todo comando entrante tiene un `clientCommandId` idéntico a `command.commandId`. Los reintentos por caída transitoria de red deben ser reconocidos y deduplicados por el par `(clientId, clientCommandId)` devolviendo la respuesta original sin re-ejecución ni avance de secuencia.
4. **Sincronización dual (Catch-up incremental vs Snapshot Fallback):** Capacidad de retransmitir comandos perdidos secuencialmente desde un registro histórico de operaciones (`OpLog`) para desconexiones cortas, y fallback a snapshot autosuficiente verificado por hash SHA-256 para brechas prolongadas.
5. **Operación offline y reactivación:** Compatibilidad plena con la cola offline local (`mobile-offline-v1.md`), garantizando que los clientes puedan almacenar operaciones en local y sincronizarlas de manera determinista al restablecerse el enlace.
6. **Invariantes arquitectónicas (`docs/ARCHITECTURE.md`):**
   - Invariante 1: Toda representación externa se convierte al modelo canónico antes de generar.
   - Invariante 2: Una entrada inválida no produce código parcial aceptable.
   - Invariante 7: Las propuestas de IA no mutan estado hasta superar validación determinista.

---

## 3. Alternativas evaluadas

### 3.1 Alternativa A: Secuenciador Centralizado (Order Authority) + Transporte WebSocket/STOMP + Persistencia Relacional con OpLog

#### Descripción técnica
- **Consistencia y orden:** Un nodo centralizado (servicio en TypeScript/Node.js o Spring Boot) actúa como autoridad de secuenciación lineal. Cada comando válido recibe un `serverSeqNumber` contiguo y monótono. Las precondiciones de `model-commands-v1.md` se evalúan secuencialmente sobre el estado canónico en memoria respaldado por base de datos. Si `command.modelVersion` no coincide con la versión activa, se emite `CommandRejected(CONCURRENT_MODIFICATION)`.
- **Modelo de transporte:** WebSockets dúplex bidireccional (con protocolo de subcapa STOMP o framing JSON canónico) para transmisión de baja latencia de tramas `SubmitCommand`, `CommandCommitted` y `Heartbeat`.
- **Persistencia y OpLog:** Almacenamiento relacional en PostgreSQL. Se persisten las entidades del modelo canónico (`domain-model.json`), una tabla de log de operaciones `collaboration_oplog` (`seq_number`, `model_id`, `client_id`, `command_id`, `command_payload`, `resulting_version`, `resulting_sha256`, `created_at`) y una tabla de deduplicación con clave primaria `(client_id, client_command_id)`.
- **Snapshots periódicos:** Checkpoints de snapshot calculados cada $N$ operaciones (p.ej., cada 100 secuencias) o por solicitud explícita, persistidos con su `modelSha256` para acelerar el arranque inicial y permitir purga segura del `OpLog`.

#### Análisis de criterios
- **Convergencia:** Fuerte y determinista. La linealización total garantiza que todos los participantes apliquen las mutaciones en idéntico orden, convergiendo invariablemente al mismo estado y hash SHA-256.
- **Operación offline y reconexión:** Flujo natural de catch-up mediante consulta de rango `seq > lastKnownSeqNumber` sobre la tabla `collaboration_oplog`. Si el cliente estuvo offline por un lapso breve, recibe las secuencias faltantes y las aplica en orden FIFO. Si el gap superó el historial podado, descarga el snapshot más reciente.
- **Complejidad:** Baja a moderada. Reutiliza directamente el motor de comandos existente (`packages/domain-validator`, `model-commands-v1`), sin requerir matemáticas de resolución de grafos distribuidos.
- **Estrategia de pruebas:** Pruebas unitarias de concurrencia y ordenación en memoria con múltiples clientes simulados; pruebas de integración de reconexión y deduplicación con base de datos PostgreSQL de prueba.

---

### 3.2 Alternativa B: CRDT basado en estado/operación (Yjs / Automerge) + Transporte WebRTC/WebSocket

#### Descripción técnica
- **Consistencia y orden:** El modelo de dominio se modela sobre tipos de datos replicados libres de conflicto (CRDTs), como `Y.Doc` o documentos Automerge. Los clientes mutan estructuras locales y difunden deltas binarios sin requerir un secuenciador central autoritativo.
- **Modelo de transporte:** Malla híbrida WebRTC para comunicación directa P2P entre clientes web, con servidor señalizador/relay de fallback WebSocket.
- **Persistencia:** Almacenamiento local de updates CRDT en IndexedDB (web) o SQLite (móvil). En el servidor, almacenamiento de bloques binarios de deltas acumulados.

#### Análisis de criterios
- **Convergencia:** Garantizada a nivel de datos primitivos (LWW sobre registros clave-valor o inserciones de texto). Sin embargo, presenta graves deficiencias para modelos estructurales con invariantes globales de integridad:
  - Si dos clientes crean concurrentemente clases con el mismo nombre en el mismo paquete, CRDT las acepta ambas, violando la precondición `DUPLICATE_CLASS_NAME`.
  - Si un cliente elimina una clase mientras otro crea una asociación hacia ella, el merge CRDT puede dejar una asociación con extremos inexistentes (referencia rota), violando la invariante 2 de `docs/ARCHITECTURE.md`.
- **Operación offline y reconexión:** Soporte offline excelente a nivel de convergencia sintáctica, pero las mutaciones offline pueden producir estados semánticos inválidos que requerirían un mecanismo de reparación complejo post-fusión.
- **Complejidad:** Muy alta. Adaptar un metamodelo UML jerárquico y relacional a primitivas CRDT exige algoritmos ad hoc de integridad referencial.
- **Estrategia de pruebas:** Muy compleja. La no linealidad y la dependencia de marcas de tiempo lógicas dificultan la reproducción exacta y determinista de trazas de error de validación.

---

### 3.3 Alternativa C: Transformación Operacional (OT) Centralizada (ShareDB/JSON-OT)

#### Descripción técnica
- **Consistencia y orden:** Servidor centralizado que aplica transformaciones operacionales sobre las operaciones entrantes respecto a operaciones concurrentes intermedias, permitiendo aplicar comandos con `baseSeqNumber < currentSeqNumber` tras transformarlos.
- **Modelo de transporte:** WebSocket sobre JSON-RPC o protocolo propietario de ShareDB.
- **Persistencia:** Base de datos de documentos (MongoDB) o PostgreSQL con log de operaciones transformadas.

#### Análisis de criterios
- **Convergencia:** Fuerte únicamente si las funciones de transformación satisfacen las condiciones teóricas TP1 y TP2.
- **Operación offline y reconexión:** Requiere transformar largas cadenas de operaciones acumuladas durante el periodo offline, con riesgo exponencial de inconsistencia en modelos estructurados.
- **Complejidad:** Extremadamente alta. Requiere definir y probar formalmente matrices de transformación bidireccional entre los 11 comandos heterogéneos de `model-commands-v1.md` ($11 \times 11 = 121$ casos combinatorios), muchos de los cuales tienen efectos estructurales destructivos en cascada (`DeleteClass` elimina asociaciones).
- **Estrategia de pruebas:** Complejidad prohibitiva para el alcance y tiempo del parcial.

---

## 4. Comparación de criterios

| Criterio evaluado | Alternativa A (Secuenciador Central + WebSocket) | Alternativa B (CRDT Yjs/Automerge) | Alternativa C (Transformación Operacional OT) |
|---|---|---|---|
| **Alineación con `model-commands-v1` y `CONCURRENT_MODIFICATION`** | **Total.** Rechazo determinista inmediato si la versión no coincide. | **Incompatible.** Diseñado para mergear concurrentemente sin rechazo. | **Incompatible.** Requiere reinterpretar y reescribir comandos. |
| **Integridad referencial e invariantes UML** | **Total.** El validador determinista protege el modelo en cada paso. | **Riesgo alto.** Genera referencias huérfanas o nombres duplicados. | **Riesgo alto.** Errores sutiles en matrices de transformación complejas. |
| **Garantía de convergencia determinista (SEC)** | **Sí.** Orden total linealizado (`seqNumber` monótono). | **Sí (sintáctica).** No garantiza validez semántica. | **Sí.** Solo si TP1/TP2 son matemáticamente perfectas. |
| **Soporte offline y reconexión (`mobile-offline-v1`)** | **Total.** Replay de cola offline y catch-up secuencial desde OpLog. | **Nativo.** Pero con riesgo de conflictos semánticos post-reconexión. | **Difícil.** Transformación de grafos extensos tras desconexión. |
| **Idempotencia y deduplicación** | **Simple y exacta.** Índice único sobre `(clientId, clientCommandId)`. | **Compleja.** Requiere deduplicación de deltas binarios. | **Media.** Seguimiento de IDs de operación. |
| **Complejidad de implementación en el parcial** | **Baja-Media.** Reutiliza validadores y contratos existentes. | **Muy alta.** Adaptar grafo UML a CRDT. | **Extrema.** 121 funciones de transformación formal. |
| **Reproducibilidad en pruebas automatizadas** | **Determinista 100%.** Trazas exactas con secuencias fijas. | **Baja.** Dependiente de latencia de red y relojes lógicos. | **Media-Baja.** Dependiente de concurrencia simulada. |

---

## 5. Decisión recomendada

**Se recomienda adoptar la Alternativa A: Secuenciador Centralizado (Order Authority) + Transporte WebSocket/STOMP + Persistencia Relacional con OpLog.**

### Fundamentos de la recomendación:
1. **Preservación irrestricta de las invariantes:** Es la única alternativa que respeta de forma estricta las precondiciones de `model-commands-v1.md` y `collaboration-protocol-v1.md`, impidiendo que comandos concurrentes desactualizados corrompan la integridad referencial del modelo canónico.
2. **Determinismo total:** El secuenciador central linealiza el flujo de eventos, eliminando incertidumbres y facilitando pruebas automatizadas reproducibles.
3. **Simplicidad arquitectónica:** No introduce complejidad algorítmica innecesaria de CRDT/OT, concentrando el esfuerzo en robustez de red, idempotencia y experiencia de usuario.
4. **Sinergia con el stack tecnológico:** Se integra de forma armónica con PostgreSQL (base de datos canónica) y con clientes tanto web (TypeScript/React) como móviles (Flutter/Dart).

---

## 6. Consecuencias y riesgos

### Consecuencias de adoptar la decisión
- El módulo `packages/collaboration-protocol` implementará el árbitro de secuencias, el buffer circular de `OpLog`, la caché de deduplicación y el despachador de eventos `CommandCommitted` / `CommandRejected`.
- La persistencia del `OpLog` y de los snapshots se modelará en el esquema de base de datos relacional para garantizar durabilidad ante reinicios del servidor.
- La aplicación móvil Flutter utilizará su cola offline existente para enviar operaciones secuenciales y solicitar catch-up mediante `lastKnownSeqNumber` al reconectar.

### Riesgos residuales y mitigación
| # | Riesgo residual | Mitigación |
|---|---|---|
| **R1** | Rechazos frecuentes por `CONCURRENT_MODIFICATION` si la latencia es alta o la edición concurrente es intensa sobre la misma clase | La interfaz del editor CASE debe ofrecer bloqueo visual cooperativo a nivel de elemento o sincronización optimista con aviso visual previo al usuario. |
| **R2** | Desbordamiento del tamaño de la tabla `collaboration_oplog` tras períodos prolongados | Política de purga automática basada en snapshots consolidados: los registros del `OpLog` anteriores al snapshot verificado más antiguo requerido se archivan o descartan. |
| **R3** | Cuello de botella en el secuenciador central para múltiples modelos | Particionamiento a nivel de aplicación: cada `modelId` tiene su propio canal y contexto de secuenciación independiente en memoria. |

---

## 7. Comandos exactos para validar la colaboración en tiempo real

Los siguientes comandos deben ejecutarse desde la raíz del repositorio para validar la conformidad de este documento de decisión y las futuras implementaciones asociadas:

```powershell
# 1. Validar que no existen errores de formato ni trailing whitespace en el ADR
git diff --check -- docs/adr/0003-realtime-collaboration.md

# 2. Verificar la presencia de las secciones normativas requeridas por la tarea P6-002
rg -n "Alternativas|converg|offline|transporte|Comandos" docs/adr/0003-realtime-collaboration.md

# 3. Validar el contrato de protocolo de colaboración contra git diff
git diff --check -- docs/contracts/collaboration-protocol-v1.md

# 4. Verificar consistencia cruzada de palabras clave en el contrato normativo
rg -n "idempoten|order|concurr|reconnect|snapshot" docs/contracts/collaboration-protocol-v1.md

# 5. Ejecutar la suite de pruebas unitarias del protocolo de colaboración (cuando sea implementado en P6-003)
# npm --prefix packages/collaboration-protocol test
```

---

## 8. Preguntas abiertas para la fase de implementación (P6-003)

1. ¿El servicio de colaboración residirá como microservicio dedicado en Node.js/TypeScript o integrado en el backend Spring Boot vía WebSockets?
2. ¿Qué intervalo de heartbeat predeterminado (p.ej., 15 segundos) y timeout de desconexión (p.ej., 45 segundos) equilibran la detección de caídas con el consumo de batería en móviles?
3. ¿Cuál será la frecuencia de consolidación de snapshots (p.ej., cada 50 comandos o cada 5 minutos de inactividad)?

---

## 10. Aprobación y decisión del Product Owner

- **Decisión:** El Product Owner aprueba formalmente la **Alternativa A** (Secuenciador Centralizado + Transporte WebSocket/STOMP + Persistencia Relacional con OpLog en PostgreSQL).
- **Estado:** `accepted`
- **Fecha:** 2026-09-20
- **Autoridad:** Product Owner (ADR-0000, PROJECT.md)

---

## 11. Referencias

- `docs/contracts/collaboration-protocol-v1.md` — Protocolo formal de colaboración y mensajes canónicos.
- `docs/contracts/model-commands-v1.md` — Catálogo de comandos deterministas del editor CASE.
- `docs/contracts/mobile-offline-v1.md` — Semántica de cola offline y reintentos para dispositivos móviles.
- `docs/ARCHITECTURE.md` — Invariantes de arquitectura y límites de módulos.
- `docs/PROJECT.md` — Decisiones fundacionales y orden de fuentes de verdad.
