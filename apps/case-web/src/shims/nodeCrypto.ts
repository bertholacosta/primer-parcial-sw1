import { sha256 } from '@noble/hashes/sha256.js';

/**
 * Shim de `node:crypto` para el bundle del navegador (vite resolve.alias).
 * Cubre exactamente lo que `collaboration-protocol` importa: randomUUID y
 * createHash('sha256') con la cadena update/digest síncrona de Node.
 */
export function randomUUID(): string {
  return globalThis.crypto.randomUUID();
}

export function createHash(algorithm: string) {
  if (algorithm !== 'sha256') {
    throw new Error(`createHash: algoritmo no soportado en el navegador: ${algorithm}`);
  }
  const hash = sha256.create();
  const encoder = new TextEncoder();
  return {
    update(data: string | Uint8Array) {
      hash.update(typeof data === 'string' ? encoder.encode(data) : data);
      return this;
    },
    digest(encoding: 'hex' | 'utf8' | 'latin1' = 'hex'): string {
      const bytes = hash.digest();
      if (encoding === 'hex') {
        return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
      }
      return new TextDecoder().decode(bytes);
    },
  };
}
