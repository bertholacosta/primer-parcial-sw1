/**
 * Framing STOMP 1.2 del lado navegador — espejo de
 * services/model-server/src/stomp.ts (misma codificación de cabeceras y
 * terminación en octeto nulo).
 */

export interface StompFrame {
  command: string;
  headers: Record<string, string>;
  body: string;
}

function unescapeHeader(value: string): string {
  return value.replace(/\\c/g, ':').replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\\\/g, '\\');
}

function escapeHeader(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/:/g, '\\c');
}

export function parseStompFrame(raw: string): StompFrame {
  const normalized = raw.replace(/^\n+/, '');
  const separator = normalized.indexOf('\n\n');
  const head = separator >= 0 ? normalized.slice(0, separator) : normalized;
  const body = separator >= 0 ? normalized.slice(separator + 2) : '';
  const lines = head.split('\n');
  const command = lines.shift()?.trim() ?? '';
  const headers: Record<string, string> = {};
  for (const line of lines) {
    const index = line.indexOf(':');
    if (index <= 0) continue;
    headers[unescapeHeader(line.slice(0, index))] = unescapeHeader(line.slice(index + 1));
  }
  return { command, headers, body };
}

export function splitStompFrames(buffer: string): { frames: string[]; rest: string } {
  const parts = buffer.split('\0');
  const rest = parts.pop() ?? '';
  return { frames: parts.filter((part) => part.trim().length > 0), rest };
}

export function encodeStompFrame(command: string, headers: Record<string, string>, body = ''): string {
  const allHeaders = { ...headers };
  if (body) allHeaders['content-length'] = String(new TextEncoder().encode(body).length);
  const lines = [
    command,
    ...Object.entries(allHeaders).map(([key, value]) => `${escapeHeader(key)}:${escapeHeader(value)}`),
    '',
    body,
  ];
  return `${lines.join('\n')}\0`;
}
