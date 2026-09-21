import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";
import { migrations } from "./migrations.js";

export interface SqlExecutor {
  query<Row extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<Row>>;
}

export interface Database extends SqlExecutor {
  transaction<T>(operation: (executor: SqlExecutor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export class PostgresDatabase implements Database {
  private readonly pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
  }

  query<Row extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<Row>> {
    return this.pool.query<Row>(text, values);
  }

  async transaction<T>(operation: (executor: SqlExecutor) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await operation(client as PoolClient);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export async function migrate(database: Database, direction: "up" | "down" = "up"): Promise<void> {
  if (direction === "up") {
    await database.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version integer PRIMARY KEY,
        applied_at timestamptz NOT NULL
      )
    `);
  }
  let applied: QueryResult<{ version: number }>;
  try {
    applied = await database.query<{ version: number }>("SELECT version FROM schema_migrations ORDER BY version");
  } catch (error) {
    if (direction === "down") return;
    throw error;
  }
  const versions = new Set(applied.rows.map((row) => Number(row.version)));
  if (direction === "up") {
    for (const migration of migrations) {
      if (versions.has(migration.version)) continue;
      await database.transaction(async (executor) => {
        await executor.query(migration.up);
        await executor.query("INSERT INTO schema_migrations(version, applied_at) VALUES ($1, $2)", [migration.version, new Date()]);
      });
    }
    return;
  }
  for (const migration of [...migrations].reverse()) {
    if (!versions.has(migration.version)) continue;
    await database.transaction(async (executor) => {
      await executor.query(migration.down);
      await executor.query("DELETE FROM schema_migrations WHERE version = $1", [migration.version]);
    });
  }
}

export async function databaseHealthy(database: SqlExecutor): Promise<boolean> {
  try {
    await database.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
