import React, { useRef, useState } from 'react';
import type { CanonicalDomainModel } from '../domain/model';
import {
  importEnterpriseArchitectXmi,
  buildEaImportCommands,
  type EaImportCommand,
  type EaImportDiagnostic,
} from '../generator/enterpriseArchitectImporter';

interface EaImportPanelProps {
  /** Modelo vigente: detecta colisiones de nombre antes de despachar. */
  existingModel: CanonicalDomainModel | null;
  /** Despacha los comandos del plan en orden a través de la sesión. */
  onApply(commands: EaImportCommand[]): void;
  /** true mientras la sesión no está en_sync. */
  applyDisabled?: boolean;
}

const ACCEPTED_TYPES = '.xmi,.xml,text/xml,application/xml';

interface ParsedImport {
  modelName: string;
  counts: { classes: number; attributes: number; relations: number };
  commands: EaImportCommand[];
  diagnostics: EaImportDiagnostic[];
  blocked: boolean;
}

const readAsText = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.readAsText(file);
  });

/** Etiquetas legibles por comando, resolviendo nombres de clase del propio lote. */
function describeCommands(commands: EaImportCommand[]): string[] {
  const names = new Map<string, string>();
  for (const cmd of commands) {
    if (cmd.type === 'CreateClass' && typeof cmd.payload.id === 'string') {
      names.set(cmd.payload.id, String(cmd.payload.name ?? cmd.payload.id));
    }
  }
  const ref = (value: unknown) => names.get(String(value)) ?? String(value ?? '?');
  return commands.map((cmd) => {
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
 * Importación de un XMI de Enterprise Architect 15: parseo determinista en el
 * cliente (xmi-adapter), panel de revisión con diagnósticos y despacho por la
 * sesión solo tras confirmación del usuario. Nunca muta el modelo por sí solo.
 */
export const EaImportPanel: React.FC<EaImportPanelProps> = ({
  existingModel,
  onApply,
  applyDisabled,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [parsed, setParsed] = useState<ParsedImport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const text = await readAsText(file);
      const result = importEnterpriseArchitectXmi(text);
      if (result.outcome === 'error' || !result.model) {
        setParsed(null);
        setError(
          result.diagnostics.map((d) => `[${d.code}] ${d.message}`).join(' ') ||
            'El archivo no es un XMI de Enterprise Architect válido.'
        );
        return;
      }
      const plan = buildEaImportCommands(result.model, existingModel);
      setParsed({
        modelName: result.model.name,
        counts: {
          classes: result.model.classes.length,
          attributes: result.model.classes.reduce((n, c) => n + c.attributes.length, 0),
          relations: result.model.associations.length,
        },
        commands: plan.commands,
        diagnostics: [...result.diagnostics, ...plan.diagnostics],
        blocked: plan.blocked,
      });
    } catch {
      setParsed(null);
      setError('No se pudo procesar el archivo XMI.');
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const close = () => {
    setParsed(null);
    setError(null);
  };

  const apply = () => {
    if (!parsed) return;
    onApply(parsed.commands);
    setParsed(null);
  };

  const labels = parsed ? describeCommands(parsed.commands) : [];
  const errors = parsed?.diagnostics.filter((d) => d.severity === 'ERROR') ?? [];
  const warnings = parsed?.diagnostics.filter((d) => d.severity !== 'ERROR') ?? [];

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_TYPES}
        data-testid="ea-file-input"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />
      <button
        data-testid="btn-import-ea"
        className="button-secondary"
        disabled={busy}
        title="Importa un diagrama exportado desde Enterprise Architect 15 (.xmi, Import/Export → Export Package to XMI)"
        onClick={() => fileInputRef.current?.click()}
      >
        {busy ? 'Leyendo XMI…' : 'Importar EA 15 (XMI)'}
      </button>

      {(parsed || error) && (
        <div
          className="proposal-panel"
          data-testid="ea-import-panel"
          role="dialog"
          aria-label="Importación de diagrama Enterprise Architect"
        >
          <div className="proposal-panel-head">
            <h3>Importar desde EA 15</h3>
            <button data-testid="btn-close-ea-import" className="button-ghost" onClick={close} aria-label="Cerrar">
              ✕
            </button>
          </div>

          {error && !parsed && (
            <p data-testid="ea-import-error" className="proposal-error">{error}</p>
          )}

          {parsed && (
            <>
              <p className="proposal-summary" data-testid="ea-import-summary">
                Modelo '{parsed.modelName}': {parsed.counts.classes} clase(s),{' '}
                {parsed.counts.attributes} atributo(s), {parsed.counts.relations} relación(es).
              </p>

              <ol className="proposal-commands" data-testid="ea-import-commands">
                {labels.map((label, i) => (
                  <li key={i}>{label}</li>
                ))}
                {labels.length === 0 && <li>El XMI no contiene elementos importables.</li>}
              </ol>

              {errors.length > 0 && (
                <ul className="proposal-diagnostics" data-testid="ea-import-errors">
                  {errors.map((d, i) => (
                    <li key={i}>[{d.code}] {d.message}</li>
                  ))}
                </ul>
              )}
              {warnings.length > 0 && (
                <ul className="proposal-diagnostics warnings" data-testid="ea-import-warnings">
                  {warnings.map((d, i) => (
                    <li key={i}>[{d.code}] {d.message}</li>
                  ))}
                </ul>
              )}

              <div className="proposal-actions">
                <button
                  data-testid="btn-apply-ea-import"
                  className="button-primary"
                  disabled={parsed.blocked || parsed.commands.length === 0 || applyDisabled}
                  title={
                    parsed.blocked
                      ? 'La importación tiene errores bloqueantes'
                      : applyDisabled
                        ? 'Espera a que la sesión esté en línea'
                        : undefined
                  }
                  onClick={apply}
                >
                  Importar {parsed.commands.length} comando(s)
                </button>
                <button data-testid="btn-discard-ea-import" className="button-secondary" onClick={close}>
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

export default EaImportPanel;
