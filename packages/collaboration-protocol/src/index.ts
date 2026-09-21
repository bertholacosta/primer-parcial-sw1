/**
 * `collaboration-protocol` — implementación del contrato
 * `docs/contracts/collaboration-protocol-v1.md` y del catálogo de comandos
 * `docs/contracts/model-commands-v1.md` para el corte mínimo.
 *
 * Neutro al transporte (I5): el coordinador emite mensajes por un callback y
 * `LocalCollaborationHub` provee un enlace loopback para pruebas y uso en
 * proceso (p. ej. `services/model-server`).
 */

export * from "./model.js";
export * from "./commands.js";
export * from "./messages.js";
export { CollaborationCoordinator } from "./coordinator.js";
export type { CoordinatorOptions } from "./coordinator.js";
export { CollaborationClient } from "./client.js";
export type { ClientOptions, ClientState } from "./client.js";
export { LocalCollaborationHub } from "./network.js";
export type { HubOptions } from "./network.js";
