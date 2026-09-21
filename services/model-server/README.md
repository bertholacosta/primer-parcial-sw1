# Model server

Backend autoritativo de la plataforma CASE: identidad (registro, login,
refresh rotatorio, logout), diagramas con membresías owner/editor/viewer,
invitaciones por correo, enlaces de compartición revocables y colaboración
en tiempo real sobre WebSocket/STOMP con persistencia PostgreSQL.

Contratos: `docs/contracts/identity-access-v1.md`,
`docs/contracts/collaboration-protocol-v1.md`. ADR: `docs/adr/0008` y
`docs/adr/0003`.

## Requisitos

- Node.js 20+ y PostgreSQL 16 (ver `docker-compose.yml` en la raíz).
- Variables de entorno: copiar `.env.example` a `.env` y ajustar. Sin
  `DATABASE_URL`, `JWT_SECRET` (≥32 chars) ni `CORS_ORIGINS` el arranque
  falla con `INVALID_CONFIG` — ver `src/config.ts`.

## Arranque en desarrollo

```powershell
# 1. Levantar PostgreSQL (desde la raíz del repo)
docker compose up -d

# 2. Variables de entorno (PowerShell 7)
cd services/model-server
$env:DATABASE_URL="postgres://postgres:postgres@localhost:15432/case"
$env:JWT_SECRET="dev-secret-dev-secret-dev-secret-32"
$env:CORS_ORIGINS="http://localhost:5173"
$env:SECURE_COOKIES="false"   # solo para http://localhost

# 3. Compilar y arrancar (las migraciones corren solas al iniciar)
npm run build
npm start
```

También vale `node --env-file=.env dist/main.js` (Node ≥20.6) en lugar de
exportar las variables a mano.

El frontend `apps/case-web` proxifica `/api` y `/collaboration` hacia
`VITE_MODEL_SERVER_URL` (default `http://localhost:3000`); el `Origin` del
navegador debe estar en `CORS_ORIGINS` o el WebSocket se rechaza.

## Superficie

- REST `/api/v1/auth/*` — register, login, refresh (cookie HttpOnly), logout.
- REST `/api/v1/users/me`, `/api/v1/diagrams[...]` — CRUD de diagramas,
  miembros, invitaciones (`/api/v1/invitations/:token/accept`) y
  share-links (`/api/v1/share-links/:token/accept`).
- WS `/collaboration` — STOMP: `CONNECT` con `authorization: Bearer`,
  `SUBSCRIBE /topic/diagrams/{id}`, `SEND /app/diagrams/{id}`.
- `GET /health` — 200/503 según la base de datos.

## Limitaciones conocidas del MVP

- `NoopMailer` no envía correos: el token de invitación solo existe dentro
  de `sendInvitation`. Hasta implementar un `Mailer` real (SMTP/API), la
  vía usable es el share-link (su URL se devuelve en la respuesta REST).
  Inyectar uno en `startModelServer({ mailer })` — ver `src/platform-store.ts`.
- Rate limiting en memoria (válido para una sola instancia).
- Sin transferencia de propiedad ni borrado de diagramas (ADR-0008).

## Pruebas

```powershell
npm run build
npm test
```

La suite usa `pg-mem` (sin PostgreSQL real) e incluye el E2E multiusuario
`test/e2e-multi-user-collaboration.test.ts`.
