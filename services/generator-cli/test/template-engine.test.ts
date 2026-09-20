import { describe, expect, it } from "vitest";
import { buildTemplateContext } from "../src/template-engine.js";

describe("template engine", () => {
  it("deriva el nombre de tabla del nombre de la clase sin prefijo de paquete", () => {
    const ctx = buildTemplateContext(
      {
        id: "m1",
        name: "Test",
        packages: [
          { id: "p1", name: "auth" },
          { id: "p2", name: "billing" }
        ],
        classes: [
          { id: "c1", name: "User", packageId: "p1", attributes: [] },
          { id: "c2", name: "User", packageId: "p2", attributes: [] }
        ],
        associations: []
      },
      { id: "c1", name: "User", packageId: "p1", attributes: [] },
      { basePackage: "org.test", generatorVersion: "1" }
    );
    expect(ctx.tableName).toBe("user");
  });
});
