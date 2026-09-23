import React, { useRef, useState } from 'react';
import {
  ApiError,
  type ImageProposal,
  type ModelServerApi,
} from '../api/modelServerApi';

interface ImageImportPanelProps {
  api: ModelServerApi;
  diagramId: string;
  /** Despacha los comandos propuestos en orden a través de la sesión. */
  onApply(commands: { type: string; payload: Record<string, unknown> }[]): void;
  /** true mientras la sesión no está en_sync: evita perder comandos al aplicar. */
  applyDisabled?: boolean;
}

const ACCEPTED_TYPES = 'image/png,image/jpeg,image/webp,image/svg+xml';

const CONFIDENCE_LABELS: Record<ImageProposal['confidence']['level'], string> = {
  HIGH: 'Alta',
  MEDIUM: 'Media',
  LOW: 'Baja',
};

const readAsBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    reader.onload = () => {
      const dataUrl = String(reader.result ?? '');
      resolve(dataUrl.slice(dataUrl.indexOf(',') + 1));
    };
    reader.readAsDataURL(file);
  });

/** Etiquetas legibles por comando, resolviendo nombres de clase del propio lote. */
function describeCommands(proposal: ImageProposal): string[] {
  const names = new Map<string, string>();
  for (const cmd of proposal.proposedCommands) {
    if (cmd.type === 'CreateClass' && typeof cmd.payload.id === 'string') {
      names.set(cmd.payload.id, String(cmd.payload.name ?? cmd.payload.id));
    }
  }
  const ref = (value: unknown) => names.get(String(value)) ?? String(value ?? '?');
  return proposal.proposedCommands.map((cmd) => {
    const p = cmd.payload;
    switch (cmd.type) {
      case 'CreateClass':
        return `Clase '${p.name}'`;
      case 'AddAttribute':
        return `Atributo '${p.name}'${p.type ? `: ${p.type}` : ''} en ${ref(p.classId)}`;
      case 'CreateAssociation': {
        const carrier = p.associationClassId ? ` (portadora: ${ref(p.associationClassId)})` : '';
        return `Relación ${p.kind ?? 'association'}: ${ref(p.sourceClassId)} → ${ref(p.targetClassId)}${carrier}`;
      }
      default:
        return cmd.type;
    }
  });
}

/**
 * Importación de imagen → propuesta multimodal (multimodal-proposals-v1):
 * sube la foto al servidor, muestra la propuesta ya validada en dry-run y
 * solo al confirmar el usuario despacha los comandos por la sesión.
 */
export const ImageImportPanel: React.FC<ImageImportPanelProps> = ({
  api,
  diagramId,
  onApply,
  applyDisabled,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState<ImageProposal | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const imageBase64 = await readAsBase64(file);
      setProposal(
        await api.createImageProposal(diagramId, {
          imageBase64,
          mimeType: file.type || 'image/png',
          capturedAt: new Date().toISOString(),
          clientPlatform: 'case_web',
        })
      );
    } catch (err) {
      setProposal(null);
      setError(err instanceof ApiError ? err.message : 'No se pudo procesar la imagen.');
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const close = () => {
    setProposal(null);
    setError(null);
  };

  const apply = () => {
    if (!proposal) return;
    onApply(proposal.proposedCommands.map((c) => ({ type: c.type, payload: c.payload })));
    setProposal(null);
  };

  const labels = proposal ? describeCommands(proposal) : [];
  const invalid = proposal?.dryRunValidation.validationStatus === 'INVALID';

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_TYPES}
        data-testid="image-file-input"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />
      <button
        data-testid="btn-import-image"
        className="button-secondary"
        disabled={busy}
        title="Sube una foto o captura de un diagrama UML para que la IA proponga clases y relaciones"
        onClick={() => fileInputRef.current?.click()}
      >
        {busy ? 'Analizando imagen…' : 'Importar imagen'}
      </button>

      {(proposal || error) && (
        <div
          className="proposal-panel"
          data-testid="image-proposal-panel"
          role="dialog"
          aria-label="Propuesta de reconocimiento de imagen"
        >
          <div className="proposal-panel-head">
            <h3>Propuesta de imagen</h3>
            <button data-testid="btn-close-proposal" className="button-ghost" onClick={close} aria-label="Cerrar">
              ✕
            </button>
          </div>

          {error && !proposal && (
            <p data-testid="image-proposal-error" className="proposal-error">{error}</p>
          )}

          {proposal && (
            <>
              {proposal.intent.summary && (
                <p className="proposal-summary" data-testid="image-proposal-summary">
                  {proposal.intent.summary}
                </p>
              )}
              <p className="proposal-meta" data-testid="image-proposal-confidence">
                Confianza: {Math.round(proposal.confidence.overall * 100)}% (
                {CONFIDENCE_LABELS[proposal.confidence.level] ?? proposal.confidence.level})
                {proposal.source?.agentRole ? ` · ${proposal.source.agentRole}` : ''}
              </p>

              <ol className="proposal-commands" data-testid="image-proposal-commands">
                {labels.map((label, i) => {
                  const score = proposal.confidence.breakdown.find((b) => b.commandIndex === i)?.score;
                  return (
                    <li key={i}>
                      {label}
                      {typeof score === 'number' && (
                        <span className="proposal-score"> {Math.round(score * 100)}%</span>
                      )}
                    </li>
                  );
                })}
                {labels.length === 0 && <li>La IA no detectó elementos.</li>}
              </ol>

              {proposal.dryRunValidation.errors.length > 0 && (
                <ul className="proposal-diagnostics" data-testid="image-proposal-errors">
                  {proposal.dryRunValidation.errors.map((d, i) => (
                    <li key={i}>[{d.code}] {d.message}</li>
                  ))}
                </ul>
              )}
              {proposal.dryRunValidation.warnings.length > 0 && (
                <ul className="proposal-diagnostics warnings" data-testid="image-proposal-warnings">
                  {proposal.dryRunValidation.warnings.map((d, i) => (
                    <li key={i}>[{d.code}] {d.message}</li>
                  ))}
                </ul>
              )}

              <div className="proposal-actions">
                <button
                  data-testid="btn-apply-proposal"
                  className="button-primary"
                  disabled={invalid || proposal.proposedCommands.length === 0 || applyDisabled}
                  title={
                    invalid
                      ? 'La propuesta no superó la validación determinista'
                      : applyDisabled
                        ? 'Espera a que la sesión esté en línea'
                        : undefined
                  }
                  onClick={apply}
                >
                  Aplicar {proposal.proposedCommands.length} comando(s)
                </button>
                <button data-testid="btn-discard-proposal" className="button-secondary" onClick={close}>
                  Descartar
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
};

export default ImageImportPanel;
