import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { databaseHealthy, migrate } from "../src/database.js";
import { createTestDatabase } from "./test-database.js";

describe("model-server infrastructure", () => {
  it("rejects incomplete configuration without exposing values", () => {
    expect(() => loadConfig({})).toThrow("INVALID_CONFIG: DATABASE_URL");
    expect(() => loadConfig({ DATABASE_URL: "postgres://secret", JWT_SECRET: "short", CORS_ORIGINS: "http://localhost" })).toThrow("INVALID_CONFIG: JWT_SECRET");
  });

  it("loads validated configuration", () => {
    const config = loadConfig({
      DATABASE_URL: "postgres://localhost/test",
      JWT_SECRET: "a".repeat(32),
      CORS_ORIGINS: "http://localhost:5173,https://case.example",
      PORT: "3100",
      SECURE_COOKIES: "false",
    });
    expect(config.port).toBe(3100);
    expect(config.corsOrigins).toEqual(["http://localhost:5173", "https://case.example"]);
    expect(config.secureCookies).toBe(false);
  });

  it("applies and reverts migrations on an isolated database", async () => {
    const database = createTestDatabase();
    await migrate(database, "up");
    expect(await databaseHealthy(database)).toBe(true);
    const users = await database.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_name = 'users'");
    expect(users.rows.some((row) => row.table_name === "users")).toBe(true);
    await migrate(database, "down");
    const reverted = await database.query("SELECT table_name FROM information_schema.tables WHERE table_name = 'users'");
    expect(reverted.rowCount).toBe(0);
    await database.close();
  });
});
