/** Configuración del extractor de visión (multimodal-proposals-v1 §5.2). */
export interface AiRecognitionConfig {
  provider: "gemini" | "ollama";
  geminiApiKey?: string;
  geminiModel: string;
  ollamaBaseUrl: string;
  ollamaModel: string;
}

export interface ModelServerConfig {
  databaseUrl: string;
  jwtSecret: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  corsOrigins: string[];
  host: string;
  port: number;
  secureCookies: boolean;
  /** Ausente cuando AI_PROVIDER no está definido: el endpoint de propuestas responde 503. */
  ai?: AiRecognitionConfig;
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`INVALID_CONFIG: ${name}`);
  return parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ModelServerConfig {
  const databaseUrl = env.DATABASE_URL?.trim();
  const jwtSecret = env.JWT_SECRET?.trim();
  const corsOrigins = env.CORS_ORIGINS?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
  if (!databaseUrl) throw new Error("INVALID_CONFIG: DATABASE_URL");
  if (!jwtSecret || jwtSecret.length < 32) throw new Error("INVALID_CONFIG: JWT_SECRET");
  if (corsOrigins.length === 0) throw new Error("INVALID_CONFIG: CORS_ORIGINS");

  const aiProvider = env.AI_PROVIDER?.trim().toLowerCase();
  let ai: AiRecognitionConfig | undefined;
  if (aiProvider === "gemini") {
    const geminiApiKey = env.GEMINI_API_KEY?.trim();
    if (!geminiApiKey) throw new Error("INVALID_CONFIG: GEMINI_API_KEY");
    ai = { provider: "gemini", geminiApiKey, geminiModel: env.GEMINI_MODEL?.trim() || "gemini-2.5-flash", ollamaBaseUrl: "", ollamaModel: "" };
  } else if (aiProvider === "ollama") {
    ai = { provider: "ollama", ollamaBaseUrl: env.OLLAMA_BASE_URL?.trim() || "http://127.0.0.1:11434", ollamaModel: env.OLLAMA_MODEL?.trim() || "llava", geminiModel: "" };
  } else if (aiProvider && aiProvider !== "none") {
    throw new Error("INVALID_CONFIG: AI_PROVIDER");
  }

  return {
    databaseUrl,
    jwtSecret,
    accessTokenTtlSeconds: positiveInteger(env.ACCESS_TOKEN_TTL_SECONDS, 900, "ACCESS_TOKEN_TTL_SECONDS"),
    refreshTokenTtlSeconds: positiveInteger(env.REFRESH_TOKEN_TTL_SECONDS, 2_592_000, "REFRESH_TOKEN_TTL_SECONDS"),
    corsOrigins,
    host: env.HOST?.trim() || "127.0.0.1",
    port: positiveInteger(env.PORT, 3000, "PORT"),
    secureCookies: env.SECURE_COOKIES !== "false",
    ai,
  };
}
