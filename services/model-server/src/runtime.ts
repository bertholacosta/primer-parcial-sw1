import type { FastifyInstance } from "fastify";
import { loadConfig, type ModelServerConfig } from "./config.js";
import { migrate, PostgresDatabase, type Database } from "./database.js";
import { buildHttpApp } from "./http-app.js";
import type { Mailer } from "./platform-store.js";

export interface RunningModelServer {
  app: FastifyInstance;
  database: Database;
  config: ModelServerConfig;
  close(): Promise<void>;
}

export async function startModelServer(input?: { config?: ModelServerConfig; database?: Database; mailer?: Mailer }): Promise<RunningModelServer> {
  const config = input?.config ?? loadConfig();
  const database = input?.database ?? new PostgresDatabase(config.databaseUrl);
  await migrate(database);
  const app = await buildHttpApp({ database, config, mailer: input?.mailer });
  await app.listen({ host: config.host, port: config.port });
  return {
    app,
    database,
    config,
    async close() {
      await app.close();
      await database.close();
    },
  };
}
