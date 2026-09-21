# Contrato de identidad, acceso y compartición — `identity-access` v1

- **Versión del contrato:** 1.0.0
- **Estado:** proposed
- **Fecha:** 2026-09-21
- **Autoridad requerida:** Product Owner
- **Depende de:** `docs/contracts/domain-model-v1.md`, `docs/contracts/collaboration-protocol-v1.md`
- **Relacionado con:** `docs/adr/0008-identity-access-and-persistent-collaboration.md`

---

## 1. Propósito y alcance

Este contrato define el comportamiento observable del MVP para registro, login, renovación y cierre de sesión, perfil propio, diagramas, membresías, invitaciones por correo y enlaces compartibles. También define cómo los roles del producto autorizan la colaboración sin cambiar la semántica de `collaboration-protocol` v1.

El contrato no define tablas, ORM, librerías criptográficas, proveedor de correo ni implementación interna. ADR-0008 decide esas tecnologías. El MVP no incluye login social, recuperación de contraseña, administración global, organizaciones, edición anónima, transferencia de propiedad ni eliminación de diagramas.

Los identificadores `userId`, `sessionId`, `diagramId`, `invitationId` y `shareLinkId` son UUID opacos. Las fechas usan ISO 8601 UTC. Ninguna respuesta ni error contiene contraseñas, hashes o tokens completos salvo el token opaco que se entrega una única vez al crear una invitación o enlace.

## 2. Formato común

### 2.1 Usuario público

```json
{
  "userId": "7ca22e79-4269-4a57-96b8-c7d245f7270d",
  "email": "ana@example.com",
  "displayName": "Ana",
  "createdAt": "2026-09-21T18:00:00Z",
  "updatedAt": "2026-09-21T18:00:00Z"
}
```

El correo se normaliza con `trim` y comparación insensible a mayúsculas; la forma canónica persistida es minúscula. Solo una cuenta activa puede tener cada correo canónico. El perfil nunca expone `passwordHash` ni artefactos de sesión.

### 2.2 Error

Toda respuesta de error usa:

```json
{
  "code": "AUTH_INVALID_CREDENTIALS",
  "message": "No fue posible autenticar la sesión.",
  "requestId": "46b8939d-b75e-4703-bd93-f2f90886f89d",
  "details": []
}
```

`message` es seguro para interfaz. `details` es opcional y solo contiene campos no sensibles. Los errores de login no permiten distinguir correo inexistente, contraseña incorrecta o cuenta inactiva.

## 3. Identidad y sesiones

### 3.1 `POST /api/v1/auth/register`

Entrada:

```json
{
  "email": "ana@example.com",
  "password": "frase-segura-de-12-o-mas",
  "displayName": "Ana"
}
```

La contraseña tiene al menos 12 caracteres y no puede ser igual al correo normalizado. Éxito: `201` con `{ "user": User }`. Si el correo ya existe, responde `EMAIL_ALREADY_REGISTERED` sin devolver información de la cuenta existente. La operación nunca inicia una segunda cuenta para el mismo correo.

### 3.2 `POST /api/v1/auth/login`

Recibe `{email, password}`. Éxito: `200` con:

```json
{
  "user": {},
  "accessToken": "jwt-opaco-para-el-cliente",
  "accessTokenExpiresAt": "2026-09-21T18:15:00Z"
}
```

El refresh token opaco se entrega exclusivamente mediante cookie `HttpOnly` y `Secure`, con política `SameSite` explícita para el despliegue; no aparece en JSON. Credenciales inválidas responden `AUTH_INVALID_CREDENTIALS`. El endpoint puede responder `AUTH_RATE_LIMITED` sin confirmar si el correo existe.

### 3.3 `POST /api/v1/auth/refresh`

Lee el refresh token desde la cookie `HttpOnly`. Un token activo se consume una única vez, se reemplaza por otro refresh token en cookie y devuelve un access token nuevo. Repetir el token consumido responde `AUTH_REFRESH_REUSE` y revoca su familia. Un token ausente, mal formado, desconocido, expirado o revocado responde `AUTH_REFRESH_INVALID`.

### 3.4 `POST /api/v1/auth/logout`

Requiere sesión autenticada. Revoca el refresh de la sesión actual, elimina su cookie y responde `204`. Repetir logout es idempotente y también responde `204`.

### 3.5 `GET /api/v1/users/me`

Devuelve `200` con `{ "user": User }` para el access token válido. Un token ausente, expirado o inválido responde `AUTH_SESSION_INVALID`.

## 4. Diagramas y membresías

### 4.1 Diagrama accesible

```json
{
  "diagramId": "99832a7b-f5f5-4ab0-b690-0b8db290ac68",
  "name": "Biblioteca",
  "role": "owner",
  "model": {
    "contractVersion": "1",
    "id": "99832a7b-f5f5-4ab0-b690-0b8db290ac68",
    "name": "Biblioteca",
    "version": "1.0.0",
    "packages": [],
    "classes": [],
    "associations": []
  }
}
```

`model` debe cumplir `domain-model` v1 y su `id` debe coincidir con `diagramId`.

### 4.2 Operaciones

- `POST /api/v1/diagrams`: crea un diagrama y una membresía `owner` para el usuario autenticado; éxito `201`.
- `GET /api/v1/diagrams`: devuelve únicamente diagramas donde el usuario tiene membresía activa; éxito `200`.
- `GET /api/v1/diagrams/{diagramId}`: requiere membresía activa; éxito `200`.
- `GET /api/v1/diagrams/{diagramId}/members`: requiere `owner`; éxito `200`.
- `PATCH /api/v1/diagrams/{diagramId}/members/{userId}`: requiere `owner` y solo admite `editor` o `viewer`; éxito `200`.
- `DELETE /api/v1/diagrams/{diagramId}/members/{userId}`: requiere `owner`, no admite eliminar al propietario; éxito `204` y es idempotente.

Cuando revelar la existencia de un diagrama permitiría enumeración, una identidad sin membresía recibe `DIAGRAM_NOT_FOUND` tanto si no existe como si no puede acceder.

### 4.3 Roles

- `owner`: lee, edita, emite comandos y administra miembros, invitaciones y enlaces.
- `editor`: lee, edita y emite comandos; no administra acceso.
- `viewer`: lee, recibe presencia y actualizaciones; no emite comandos.

La traducción obligatoria a `ParticipantRole` es `owner` → `admin`, `editor` → `editor` y `viewer` → `viewer`. Un `SubmitCommand` no autorizado se rechaza con `INSUFFICIENT_PERMISSIONS`, sin mutación ni avance de `serverSeqNumber`. La membresía se vuelve a verificar antes de aceptar cada comando.

## 5. Invitaciones por correo

### 5.1 Crear

`POST /api/v1/diagrams/{diagramId}/invitations` requiere `owner` y recibe:

```json
{
  "email": "bruno@example.com",
  "role": "editor",
  "expiresAt": "2026-09-24T18:00:00Z"
}
```

`role` solo puede ser `editor` o `viewer`. La expiración es futura y no supera siete días. Éxito: `201` con `invitationId`, `role`, `expiresAt` y un token opaco mostrado una única vez al adaptador de entrega. Solo se persiste su hash. Crear otra invitación pendiente para el mismo diagrama y correo revoca la anterior.

Estados observables: `pending`, `accepted`, `revoked`, `expired`. El propietario puede revocar una invitación pendiente. Revocar repetidamente es idempotente.

### 5.2 Aceptar

`POST /api/v1/invitations/{token}/accept` requiere login. El correo canónico de la sesión debe coincidir con el destinatario. La transición `pending` → `accepted` y la creación o actualización de membresía son atómicas. Repetir el canje por el mismo usuario devuelve la membresía existente sin duplicarla. Tokens desconocidos, expirados, revocados o usados por otra identidad responden `INVITATION_INVALID`.

## 6. Enlaces compartibles

### 6.1 Crear y revocar

`POST /api/v1/diagrams/{diagramId}/share-links` requiere `owner` y recibe `role`, `expiresAt` y opcionalmente `maxUses`. Solo admite `editor` o `viewer`; la expiración no supera siete días. Éxito `201`: devuelve `shareLinkId`, metadatos y token opaco una sola vez. Solo se persiste el hash.

`DELETE /api/v1/diagrams/{diagramId}/share-links/{shareLinkId}` requiere `owner`, revoca inmediatamente y responde `204`. Repetir la revocación es idempotente.

### 6.2 Aceptar

`POST /api/v1/share-links/{token}/accept` requiere login. El consumo incrementa usos y crea o actualiza la membresía en una transacción. Repetir el canje por el mismo usuario no crea duplicados ni consume otro uso. Un token expirado, revocado, sin usos o desconocido responde `SHARE_LINK_INVALID`.

## 7. Catálogo de errores

- `VALIDATION_ERROR` (`400`): entrada mal formada.
- `EMAIL_ALREADY_REGISTERED` (`409`): correo canónico ocupado.
- `AUTH_INVALID_CREDENTIALS` (`401`): login rechazado de forma genérica.
- `AUTH_SESSION_INVALID` (`401`): access token ausente o inválido.
- `AUTH_REFRESH_INVALID` (`401`): refresh no utilizable.
- `AUTH_REFRESH_REUSE` (`401`): reuso detectado; familia revocada.
- `AUTH_RATE_LIMITED` (`429`): límite temporal superado.
- `DIAGRAM_NOT_FOUND` (`404`): diagrama inexistente o no visible.
- `INSUFFICIENT_PERMISSIONS` (`403`): rol insuficiente.
- `OWNER_REQUIRED` (`409`): operación rompería el propietario único.
- `INVITATION_INVALID` (`409`): invitación no canjeable.
- `INVITATION_EMAIL_MISMATCH` (`403`): destinatario distinto.
- `SHARE_LINK_INVALID` (`409`): enlace no canjeable.

Todos los rechazos son libres de efectos salvo la revocación de familia exigida por `AUTH_REFRESH_REUSE`.

## 8. Escenarios normativos

### 8.1 Owner invita a editor

1. Ana ejecuta `register`, luego `login` y crea el diagrama `Biblioteca`; recibe `owner`.
2. Ana crea una invitation para `bruno@example.com` con rol `editor`.
3. Bruno se registra, inicia sesión y acepta el token recibido; queda una sola membresía `editor`.
4. Bruno se une a colaboración como `editor` y su comando válido puede producir `CommandCommitted`.
5. Bruno intenta invitar a otra persona; recibe `INSUFFICIENT_PERMISSIONS` y no se crea invitation.

### 8.2 Viewer no puede editar

1. Ana crea un share link `viewer` de un uso.
2. Bruno lo acepta autenticado; repetir la aceptación no consume otro uso.
3. Bruno recibe actualizaciones y presencia.
4. Bruno fabrica `SubmitCommand`; el servidor responde `INSUFFICIENT_PERMISSIONS`, el modelo y `serverSeqNumber` permanecen iguales.

### 8.3 Revocación y expiración

1. Ana revoca una invitation pendiente; el destinatario recibe `INVITATION_INVALID` al canjearla.
2. Ana revoca un share link; usuarios con membresía previa conservan esa membresía, pero el enlace no crea otras.
3. Dos canjes concurrentes del último uso se serializan: exactamente uno tiene éxito.

## 9. Compatibilidad y evolución

Los consumidores deben ignorar campos desconocidos que no amplíen permisos. Añadir campos opcionales o nuevos códigos de error específicos es compatible dentro de v1. Cambiar roles, elevar capacidades, exponer secretos, modificar idempotencia o reutilizar códigos con otra semántica requiere v2 y ADR aceptado.

Este documento permanece `proposed` hasta que el Product Owner registre su aprobación explícita. Ninguna implementación dependiente puede declarar conformidad definitiva mientras el contrato no esté `accepted`.
