/**
 * Transporte en memoria (loopback) entre clientes y coordinador.
 *
 * El contrato es neutro al transporte (I5); este hub implementa un enlace
 * síncrono, ordenado y fiable por conexión — el supuesto 13.1 del contrato —
 * con control explícito de corte de enlace y descarte de mensajes para
 * reproducir las trazas normativas de desconexión y pérdida de respuestas.
 */

import { randomUUID } from "node:crypto";
import { CollaborationCoordinator } from "./coordinator.js";
import type { CoordinatorOptions } from "./coordinator.js";
import { CollaborationClient } from "./client.js";
import type { DomainModel } from "./model.js";
import type { Envelope } from "./messages.js";

export interface HubOptions {
  sessionId?: string;
  oplogRetention?: number;
  initialSeqNumber?: number;
  resolveRole?: CoordinatorOptions["resolveRole"];
  requireAuth?: boolean;
}

export class LocalCollaborationHub {
  readonly coordinator: CollaborationCoordinator;

  private readonly clients = new Map<string, CollaborationClient>();
  private readonly linkUp = new Map<string, boolean>();
  private dropNextOutbound = new Set<string>();

  constructor(model: DomainModel, options: HubOptions = {}) {
    this.coordinator = new CollaborationCoordinator(model, {
      sessionId: options.sessionId ?? `sess-${randomUUID()}`,
      oplogRetention: options.oplogRetention,
      initialSeqNumber: options.initialSeqNumber,
      resolveRole: options.resolveRole,
      requireAuth: options.requireAuth,
      emit: (clientId, envelope) => this.deliverToClient(clientId, envelope),
    });
  }

  get sessionId(): string {
    return this.coordinator.sessionId;
  }

  /** Crea y registra un cliente cableado al coordinador por este hub. */
  createClient(
    clientId: string,
    options: { authToken?: string; initialModel?: DomainModel; initialSeqNumber?: number; clientMetadata?: Record<string, unknown> } = {},
  ): CollaborationClient {
    const client = new CollaborationClient({
      clientId,
      modelId: this.coordinator.modelId,
      authToken: options.authToken ?? `token-${clientId}`,
      initialModel: options.initialModel,
      initialSeqNumber: options.initialSeqNumber,
      clientMetadata: options.clientMetadata,
      send: (envelope) => this.receiveFromClient(clientId, envelope),
    });
    this.clients.set(clientId, client);
    this.linkUp.set(clientId, true);
    return client;
  }

  /** Conecta el enlace de un cliente y dispara su JoinSession. */
  connect(clientId: string): void {
    this.linkUp.set(clientId, true);
    const client = this.requireClient(clientId);
    if (client.sessionId) {
      client.reconnect();
    } else {
      client.connect(this.sessionId);
    }
  }

  /** Corta el enlace: los mensajes en ambas direcciones se pierden. */
  disconnect(clientId: string): void {
    this.linkUp.set(clientId, false);
    this.requireClient(clientId).disconnect();
  }

  /** Descarta el próximo mensaje S2C dirigido al cliente (respuesta perdida). */
  dropNextMessageFor(clientId: string): void {
    this.dropNextOutbound.add(clientId);
  }

  client(clientId: string): CollaborationClient {
    return this.requireClient(clientId);
  }

  private receiveFromClient(clientId: string, envelope: Envelope): void {
    if (this.linkUp.get(clientId) !== true) return; // sin enlace: el paquete se pierde
    this.coordinator.handleMessage(clientId, envelope);
  }

  private deliverToClient(clientId: string, envelope: Envelope): void {
    if (this.linkUp.get(clientId) !== true) return; // sin enlace: el paquete se pierde
    if (this.dropNextOutbound.has(clientId)) {
      this.dropNextOutbound.delete(clientId);
      return;
    }
    this.clients.get(clientId)?.deliver(envelope);
  }

  private requireClient(clientId: string): CollaborationClient {
    const client = this.clients.get(clientId);
    if (!client) {
      throw new Error(`Cliente '${clientId}' no registrado en el hub.`);
    }
    return client;
  }
}
