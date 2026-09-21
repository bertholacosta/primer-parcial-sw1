import { newDb } from "pg-mem";
import type { QueryResult, QueryResultRow } from "pg";
import type { Database, SqlExecutor } from "../src/database.js";

export function createTestDatabase(): Database {
  const memory = newDb({ autoCreateForeignKeyIndices: true });
  const adapter = memory.adapters.createPg();
  const pool = new adapter.Pool();
  return {
    async query<Row extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<Row>> {
      return pool.query(text, values) as Promise<QueryResult<Row>>;
    },
    async transaction<T>(operation: (executor: SqlExecutor) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await operation({
          query<Row extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<Row>> {
            return client.query(text, values) as Promise<QueryResult<Row>>;
          },
        });
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    async close(): Promise<void> {
      await pool.end();
    },
  };
}
