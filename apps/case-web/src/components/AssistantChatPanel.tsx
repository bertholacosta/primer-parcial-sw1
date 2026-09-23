import React, { useEffect, useRef, useState } from 'react';
import type { CanonicalDomainModel } from '../domain/model';
import {
  parseAssistantMessage,
  describeAssistantCommand,
  type AssistantCommand,
} from '../assistant/assistantParser';

/** Resultado de la interpretación remota (IA en el servidor). */
export interface AssistantRemoteResult {
  commands?: AssistantCommand[];
  summary?: string;
  clarification?: string;
}

interface AssistantChatPanelProps {
  model: CanonicalDomainModel;
  /** Despacha los comandos confirmados (sesión colaborativa o ejecutor local). */
  onApply(commands: AssistantCommand[]): void;
  /** true mientras la sesión no está en_sync. */
  applyDisabled?: boolean;
  /**
   * Fallback cuando el parser local no entiende la frase: llama al intérprete
   * de IA del servidor (modalidad text_prompt). Ausente en modo standalone.
   */
  onInterpretRemote?: (text: string) => Promise<AssistantRemoteResult>;
}

interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  commands?: AssistantCommand[];
  status?: 'pending' | 'applied' | 'discarded';
}

/** Tipado mínimo de la Web Speech API (no está en lib.dom de TS). */
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult:
    | ((event: {
        resultIndex: number;
        results: { isFinal: boolean; 0: { transcript: string } }[];
      }) => void)
    | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
}

const createRecognition = (): SpeechRecognitionLike | null => {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
};

let messageSeq = 0;
const nextMessageId = () => ++messageSeq;

/**
 * Chat del asistente del lienzo: el usuario escribe o dicta instrucciones en
 * español; el parser determinista las convierte en comandos del contrato que
 * se muestran como propuesta revisable. Solo al pulsar "Aplicar" se despachan.
 */
export const AssistantChatPanel: React.FC<AssistantChatPanelProps> = ({
  model,
  onApply,
  applyDisabled,
  onInterpretRemote,
}) => {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: nextMessageId(),
      role: 'assistant',
      text: 'Hola — soy el asistente del diagrama. Escribe o dicta instrucciones como "crea clase Cliente con nombre String, email String" o "crea asociación entre Cliente y Venta". Escribe "ayuda" para ver todo lo que entiendo.',
    },
  ]);
  const [input, setInput] = useState('');
  const [listening, setListening] = useState(false);
  const [interpreting, setInterpreting] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const voiceSupported =
    typeof window !== 'undefined' &&
    Boolean(
      (window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown })
        .SpeechRecognition ??
        (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition
    );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView?.({ behavior: 'smooth' });
  }, [messages, open]);

  useEffect(
    () => () => {
      recognitionRef.current?.stop();
    },
    []
  );

  const send = (rawText: string) => {
    const text = rawText.trim();
    if (!text || interpreting) return;
    setInput('');
    const parsed = parseAssistantMessage(text, model);
    const userMsg: ChatMessage = { id: nextMessageId(), role: 'user', text };

    if (parsed.commands.length > 0 || !onInterpretRemote) {
      setMessages((prev) => [
        ...prev,
        userMsg,
        parsed.commands.length > 0
          ? {
              id: nextMessageId(),
              role: 'assistant',
              text: parsed.summary,
              commands: parsed.commands,
              status: 'pending',
            }
          : { id: nextMessageId(), role: 'assistant', text: parsed.clarification ?? 'No entendí la instrucción.' },
      ]);
      return;
    }

    // El parser local no entendió la frase: fallback a la IA del servidor.
    const thinkingId = nextMessageId();
    setInterpreting(true);
    setMessages((prev) => [
      ...prev,
      userMsg,
      { id: thinkingId, role: 'assistant', text: 'Consultando a la IA…' },
    ]);
    const interpret = onInterpretRemote;
    void interpret(text)
      .then((result) => {
        const commands = result.commands ?? [];
        setMessages((prev) =>
          prev.map((m) =>
            m.id === thinkingId
              ? commands.length > 0
                ? { ...m, text: result.summary ?? 'La IA propone:', commands, status: 'pending' }
                : { ...m, text: result.clarification ?? 'La IA tampoco entendió la instrucción.' }
              : m
          )
        );
      })
      .catch(() => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === thinkingId
              ? { ...m, text: 'No fue posible contactar con la IA. Intenta con una frase más directa.' }
              : m
          )
        );
      })
      .finally(() => setInterpreting(false));
  };

  const apply = (msg: ChatMessage) => {
    const commands = msg.commands;
    if (!commands?.length) return;
    onApply(commands);
    setMessages((prev) => [
      ...prev.map((m) => (m.id === msg.id ? { ...m, status: 'applied' as const } : m)),
      {
        id: nextMessageId(),
        role: 'assistant',
        text: `Hecho — apliqué ${commands.length} comando(s).`,
      },
    ]);
  };

  const discard = (msg: ChatMessage) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === msg.id ? { ...m, status: 'discarded' as const } : m))
    );
  };

  const toggleListening = () => {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const rec = createRecognition();
    if (!rec) return;
    recognitionRef.current = rec;
    rec.lang = 'es-ES';
    rec.continuous = false;
    rec.interimResults = true;
    rec.onresult = (event) => {
      let finalTranscript = '';
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) finalTranscript += result[0].transcript;
        else interim += result[0].transcript;
      }
      if (finalTranscript) {
        send(finalTranscript);
      } else if (interim) {
        setInput(interim);
      }
    };
    rec.onend = () => {
      setListening(false);
      recognitionRef.current = null;
    };
    rec.onerror = () => {
      setListening(false);
      recognitionRef.current = null;
    };
    rec.start();
    setListening(true);
  };

  const pendingNames = (commands: AssistantCommand[]) => {
    const map = new Map<string, string>();
    for (const c of commands) {
      if (c.type === 'CreateClass') map.set(String(c.payload.id), String(c.payload.name));
    }
    return map;
  };

  if (!open) {
    return (
      <button
        type="button"
        data-testid="assistant-fab"
        className="chat-fab"
        title="Abrir el asistente del diagrama (texto o voz)"
        onClick={() => setOpen(true)}
      >
        Asistente
      </button>
    );
  }

  return (
    <div className="chat-panel" data-testid="assistant-panel" role="dialog" aria-label="Asistente del diagrama">
      <div className="chat-header">
        <span>Asistente del diagrama</span>
        <button
          type="button"
          data-testid="assistant-close"
          className="button-ghost"
          aria-label="Cerrar asistente"
          onClick={() => setOpen(false)}
        >
          ✕
        </button>
      </div>

      <div className="chat-messages" data-testid="assistant-messages">
        {messages.map((msg) => (
          <div key={msg.id} className={`chat-msg ${msg.role}`}>
            <div className="chat-bubble">
              <span>{msg.text}</span>
              {msg.commands && msg.commands.length > 0 && (
                <div className="chat-proposal" data-testid={`chat-proposal-${msg.id}`}>
                  <ol>
                    {msg.commands.map((cmd, i) => (
                      <li key={i}>{describeAssistantCommand(cmd, model, pendingNames(msg.commands!))}</li>
                    ))}
                  </ol>
                  {msg.status === 'pending' && (
                    <div className="chat-proposal-actions">
                      <button
                        type="button"
                        data-testid={`chat-apply-${msg.id}`}
                        className="button-primary"
                        disabled={applyDisabled}
                        title={applyDisabled ? 'Espera a que la sesión esté en línea' : undefined}
                        onClick={() => apply(msg)}
                      >
                        Aplicar
                      </button>
                      <button
                        type="button"
                        data-testid={`chat-discard-${msg.id}`}
                        className="button-secondary"
                        onClick={() => discard(msg)}
                      >
                        Descartar
                      </button>
                    </div>
                  )}
                  {msg.status === 'applied' && <span className="chat-status applied">Aplicado ✓</span>}
                  {msg.status === 'discarded' && <span className="chat-status">Descartado</span>}
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <form
        className="chat-input-row"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <input
          data-testid="assistant-input"
          className="field-control chat-input"
          placeholder={listening ? 'Escuchando…' : 'Escribe una instrucción…'}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          aria-label="Instrucción para el asistente"
        />
        <button
          type="button"
          data-testid="assistant-mic"
          className={`chat-mic${listening ? ' listening' : ''}`}
          disabled={!voiceSupported}
          title={voiceSupported ? (listening ? 'Detener dictado' : 'Dictar por voz') : 'Voz no soportada en este navegador'}
          aria-label={listening ? 'Detener dictado' : 'Dictar por voz'}
          aria-pressed={listening}
          onClick={toggleListening}
        >
          {listening ? '■' : '🎙'}
        </button>
        <button type="submit" data-testid="assistant-send" className="button-primary chat-send" disabled={!input.trim() || interpreting}>
          Enviar
        </button>
      </form>
    </div>
  );
};

export default AssistantChatPanel;
