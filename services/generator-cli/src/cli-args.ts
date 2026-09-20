export interface CliArgs {
  modelPath?: string;
  outputDir?: string;
  configPath?: string;
  help: boolean;
}

export const USAGE =
  "Uso: generator-cli --model <domain-model.json> --output <directorio> --config <config.json>";

/**
 * Parsea los argumentos del CLI (ADR-0002: `--model`, `--output`, `--config`).
 * `--output` tiene prioridad sobre el campo `outputDir` del fichero de
 * configuración.
 */
export function parseCliArgs(argv: string[]): CliArgs {
  const args: CliArgs = { help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--model") {
      args.modelPath = argv[++i];
    } else if (arg === "--output") {
      args.outputDir = argv[++i];
    } else if (arg === "--config") {
      args.configPath = argv[++i];
    }
  }
  return args;
}
