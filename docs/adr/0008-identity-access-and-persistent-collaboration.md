# ADR-0008: identidad, acceso y colaboración persistente

- **Estado:** `proposed`
- **Decisor:** Product Owner
- **Fecha:** 2026-09-21
- **Autor:** Devin
- **Relacionado con:** `docs/adr/0003-realtime-collaboration.md`, `docs/contracts/collaboration-protocol-v1.md`, `docs/contracts/model-commands-v1.md`, `services/model-server/`, `apps/case-web/`

---

## 1. Pregunta

¿Cómo incorporar registro e inicio de sesión con correo y contraseña, propiedad y permisos por diagrama, invitaciones por correo y enlace, persistencia PostgreSQL y coedición simultánea en `case-web` sin debilitar las garantías deterministas del protocolo de colaboración aceptado?

## 2. Decisiones de producto recibidas

Para el alcance propuesto se registran estas decisiones:

1. El inicio de sesión usa correo y contraseña.
2. Cada diagrama distingue propietario, editor y lector.
3. Un diagrama puede compartirse por invitación a un correo o mediante enlace revocable.
4. Varios usuarios autorizados pueden construir el mismo diagrama simultáneamente.
5. Este ADR permanece `proposed` hasta recibir aprobación explícita del Product Owner.

## 3. Contexto

`apps/case-web` mantiene hoy el modelo en estado local y no se conecta a un servicio. `services/model-server` hospeda modelos y sesiones únicamente en memoria. `packages/collaboration-protocol` ya implementa coordinación, secuencias, presencia, deduplicación y roles `admin`, `editor` y `viewer`, pero no valida identidades persistentes ni proporciona transporte de red.

ADR-0003 ya exige un secuenciador centralizado, WebSocket/STOMP y persistencia relacional PostgreSQL con `OpLog`, deduplicación y snapshots. Esta propuesta complementa esa decisión; no reemplaza el protocolo ni introduce CRDT u OT.

## 4. Alcance del MVP

El MVP incluye:

- registro, login, renovación de sesión, logout y consulta del perfil propio;
- contraseñas almacenadas exclusivamente mediante hash resistente a ataques offline;
- creación y listado de diagramas accesibles por el usuario;
- propietario único por diagrama;
- membresías `owner`, `editor` y `viewer`;
- invitaciones dirigidas a correo y enlaces compartibles con rol, expiración y revocación;
- carga y persistencia del modelo canónico;
- transporte WebSocket/STOMP para el protocolo de colaboración v1;
- presencia, reconexión, catch-up y snapshot fallback;
- persistencia de `OpLog` y deduplicación durante al menos 24 horas;
- integración de login, selector de diagramas, compartir y coedición en `case-web`;
- pruebas con dos usuarios y verificación posterior a reinicio del servidor.

Quedan fuera del MVP:

- login social;
- administración global de usuarios;
- recuperación de contraseña por correo;
- organizaciones o equipos;
- edición anónima;
- permisos por clase o atributo;
- generación del backend Spring Boot desde el navegador;
- despliegue multi-región o secuenciación distribuida.

## 5. Alternativas consideradas

### 5.1 Extender `model-server` como servicio de identidad y colaboración

El servicio Node.js/TypeScript existente expone REST para identidad y recursos, y WebSocket/STOMP para colaboración. PostgreSQL es su almacenamiento autoritativo.

Ventajas:

- reutiliza el coordinador y los contratos implementados;
- mantiene una sola autoridad para autenticar, autorizar y secuenciar;
- evita duplicar el modelo de permisos entre servicios;
- permite entregar el MVP de forma incremental.

Riesgos:

- aumenta responsabilidades de `model-server`;
- exige límites internos claros entre identidad, diagramas y colaboración.

### 5.2 Crear un servicio de identidad independiente

Un servicio nuevo emite tokens y `model-server` consulta o valida sus credenciales.

Ventajas:

- separación organizativa y escalado independiente.

Riesgos:

- añade comunicación, despliegue, rotación de claves y consistencia entre servicios;
- es complejidad innecesaria para el alcance actual.

### 5.3 Implementar identidad en el backend Spring Boot generado

Cada proyecto generado gestionaría usuarios y permisos del editor CASE.

Se rechaza porque confunde la plataforma de modelado con el software producido por el generador. Un backend generado no debe ser autoridad de identidad para `case-web`.

## 6. Decisión recomendada

Adoptar la alternativa 5.1: ampliar `services/model-server` como backend autoritativo de la plataforma, conservando módulos internos separados y el protocolo existente.

### 6.1 Fronteras

- REST JSON gestiona registro, sesiones, perfil, diagramas, miembros e invitaciones.
- WebSocket/STOMP transporta exclusivamente envelopes de `collaboration-protocol-v1`.
- PostgreSQL conserva usuarios, sesiones, diagramas, permisos, invitaciones, snapshots, operaciones y deduplicación.
- `packages/collaboration-protocol` permanece independiente de HTTP, STOMP, JWT y PostgreSQL.
- `apps/case-web` nunca decide permisos; solo refleja los permisos adjudicados por el servidor.
- `services/generator-cli` y los proyectos Spring Boot generados no participan en la identidad de la plataforma.

### 6.2 Sesiones y credenciales

- El correo se normaliza y se aplica unicidad insensible a mayúsculas.
- La contraseña se almacena con Argon2id y parámetros versionados; nunca se registra ni retorna.
- Tras login, el servidor emite un access token JWT de corta duración.
- El refresh token es opaco, rotatorio, se almacena con hash y se entrega en cookie `HttpOnly`, `Secure` y `SameSite` configurable según el despliegue.
- El logout revoca la sesión de refresh correspondiente.
- Los errores de login no revelan si el correo existe.
- Registro, login y renovación tienen rate limiting.
- Las claves y secretos provienen del entorno o del gestor de secretos y nunca del repositorio.

### 6.3 Autorización por diagrama

Los roles de producto se traducen al protocolo existente:

- `owner` → `admin`;
- `editor` → `editor`;
- `viewer` → `viewer`.

Reglas:

1. Cada diagrama tiene exactamente un propietario activo.
2. El propietario puede administrar miembros, invitaciones y enlaces.
3. Un editor puede leer el diagrama y emitir comandos.
4. Un lector puede leer, recibir presencia y actualizaciones, pero no emitir comandos.
5. El servidor deriva `userId` del token validado; ignora identidades de usuario declaradas por el cliente.
6. El rol se consulta al unirse a la sesión y se vuelve a comprobar antes de aceptar cada comando para que una revocación tenga efecto.
7. La eliminación o transferencia de propiedad queda fuera del MVP salvo que se especifique posteriormente.

### 6.4 Invitaciones

Invitación por correo:

- registra el correo normalizado, rol ofrecido, emisor, expiración y estado;
- si el usuario ya existe, aparece como invitación pendiente y puede notificarse por un adaptador de correo;
- aceptar la invitación crea o actualiza una membresía de forma idempotente;
- el token de aceptación es opaco, aleatorio y solo se persiste su hash.

Enlace compartible:

- contiene un token opaco con entropía suficiente;
- define `editor` o `viewer`, expiración y opcionalmente límite de usos;
- puede revocarse inmediatamente;
- al canjearse exige una sesión autenticada y crea una membresía;
- el token completo no se registra en logs ni se guarda en texto plano.

### 6.5 Persistencia mínima

El esquema lógico requiere:

- `users`: identidad, correo normalizado, hash de contraseña y estado;
- `auth_sessions`: hash del refresh token, usuario, expiración y revocación;
- `diagrams`: propietario, nombre, modelo canónico JSONB, versión y hash;
- `diagram_members`: diagrama, usuario y rol;
- `diagram_invitations`: invitación por correo, rol, hash de token, estado y expiración;
- `diagram_share_links`: hash de token, rol, expiración, revocación y usos;
- `collaboration_oplog`: secuencia, emisor, comando, versión y hash resultantes;
- `collaboration_dedup`: clave `(diagram_id, client_id, client_command_id)` y resultado original;
- `collaboration_snapshots`: secuencia base, versión, hash y modelo JSONB.

Las mutaciones de modelo, el avance de secuencia, `OpLog` y deduplicación se confirman en una única transacción. El par `(diagram_id, seq_number)` es único. Las migraciones son versionadas y Hibernate no administra este esquema.

### 6.6 Colaboración simultánea

1. `case-web` obtiene un access token mediante REST.
2. Abre WebSocket/STOMP y autentica la conexión.
3. Envía `JoinSession` para el diagrama solicitado.
4. El servidor valida identidad y membresía y asigna el rol normativo.
5. El servidor entrega snapshot o catch-up según `lastKnownSeqNumber`.
6. Los editores envían `SubmitCommand`; el secuenciador valida versión, rol e invariantes.
7. Un comando aceptado se persiste y luego se difunde como `CommandCommitted`.
8. Los demás clientes aplican los commits en orden de `serverSeqNumber`.
9. Un comando concurrente desactualizado se rechaza con `CONCURRENT_MODIFICATION`; no se fusiona silenciosamente.

### 6.7 API mínima propuesta

Identidad:

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `GET /api/v1/users/me`

Diagramas y permisos:

- `GET /api/v1/diagrams`
- `POST /api/v1/diagrams`
- `GET /api/v1/diagrams/{diagramId}`
- `GET /api/v1/diagrams/{diagramId}/members`
- `PATCH /api/v1/diagrams/{diagramId}/members/{userId}`
- `DELETE /api/v1/diagrams/{diagramId}/members/{userId}`

Invitaciones:

- `POST /api/v1/diagrams/{diagramId}/invitations`
- `POST /api/v1/invitations/{token}/accept`
- `POST /api/v1/diagrams/{diagramId}/share-links`
- `POST /api/v1/share-links/{token}/accept`
- `DELETE /api/v1/diagrams/{diagramId}/share-links/{linkId}`

Colaboración:

- endpoint WebSocket/STOMP versionado, con destinos concretos definidos por el contrato de transporte antes de implementar.

## 7. Garantías de seguridad

- Todas las rutas, excepto registro, login, refresh y canje autenticado explícitamente indicado, requieren autenticación.
- Cada consulta o mutación de diagrama incluye control de pertenencia en el servidor.
- Los tokens de invitación, enlace y refresh se comparan por hash.
- Las respuestas no incluyen `passwordHash`, hashes de tokens ni secretos.
- Los payloads tienen límites de tamaño y validación estructural.
- CORS y cookies usan listas explícitas de orígenes; no se combina credenciales con origen comodín.
- WebSocket valida origen y credenciales antes de aceptar suscripciones o mensajes.
- Los eventos de login, logout, invitación, cambio de rol y revocación producen auditoría sin datos sensibles.

## 8. Consistencia y fallos

- PostgreSQL es la fuente de verdad durable; la memoria es caché reconstruible.
- Un proceso puede mantener un coordinador por diagrama activo, conforme a ADR-0003.
- Para el MVP, solo una instancia escritora procesa un diagrama a la vez.
- Tras reiniciar el servicio, el coordinador reconstruye el estado desde el último snapshot y el `OpLog` posterior.
- Ningún `CommandCommitted` se difunde antes de confirmar su transacción.
- Si la persistencia falla, el comando se rechaza o la sesión se interrumpe sin avanzar el estado observable.

## 9. Consecuencias

Positivas:

- identidad y autorización quedan unificadas con la autoridad de secuenciación;
- el protocolo existente se reutiliza sin alterar su semántica;
- los diagramas sobreviven a reinicios;
- `case-web` puede representar presencia y roles reales.

Costes y riesgos:

- se incorpora PostgreSQL como dependencia operativa de la plataforma;
- el servicio requiere migraciones, gestión de secretos y políticas de sesión;
- el envío real de correos necesita un proveedor y configuración externa;
- el rechazo por concurrencia debe explicarse y permitir reintento explícito en la interfaz;
- el escalado horizontal requiere posteriormente una estrategia de propiedad o bloqueo por `diagramId`.

## 10. Estrategia de entrega

La implementación se divide en tareas pequeñas: contrato, aprobación del ADR, infraestructura PostgreSQL, autenticación, recursos de diagramas, invitaciones, persistencia colaborativa, transporte WebSocket/STOMP, integración web y aceptación extremo a extremo. Ninguna tarea de implementación se habilita hasta que el contrato y este ADR estén aceptados.

## 11. Validación documental

```pwsh
git diff --check -- docs/adr/0008-identity-access-and-persistent-collaboration.md
rg -n "Estado|Alternativas|Argon2id|owner|editor|viewer|PostgreSQL|WebSocket|STOMP|OpLog|Validación" docs/adr/0008-identity-access-and-persistent-collaboration.md
```

## 12. Aprobación requerida

Para pasar a `accepted`, el Product Owner debe confirmar expresamente:

1. `model-server` será el backend autoritativo de identidad y colaboración.
2. Se aprueba access JWT más refresh token opaco rotatorio.
3. Se aprueban los roles propietario, editor y lector y su traducción al protocolo.
4. Los enlaces compartibles exigirán login antes de crear membresía.
5. La primera entrega usa una sola instancia escritora por diagrama.
