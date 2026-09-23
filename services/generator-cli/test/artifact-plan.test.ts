import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { canonicalize, type DomainModel } from "domain-model";
import { planClassArtifactPaths } from "../src/artifact-plan.js";
import type { GenerationConfig } from "../src/config.js";

function fixture(name: string): DomainModel {
  const path = fileURLToPath(new URL(`../../../fixtures/models/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8")) as DomainModel;
}

const config: GenerationConfig = {
  outputDir: "out",
  basePackage: "com.example.biblioteca",
  artifactId: "biblioteca",
  groupId: "com.example",
  generatorVersion: "0.1.0",
  templateSetId: "spring-boot-jpa-v1",
};

describe("planificación ordenada de artefactos de capa (§5.1)", () => {
  it("produce las cinco rutas por clase en orden canónico de clases y orden fijo de capas", () => {
    const model = canonicalize(fixture("valid-minimal.json"));
    const plan = planClassArtifactPaths(model, config);

    expect(plan).toHaveLength(10);
    const paths = plan.map((a) => a.relativePath);
    // §6.2: todas las clases viven en el paquete raíz {basePackage}.
    expect(paths).toEqual([
      "src/main/java/com/example/biblioteca/entity/LibroEntity.java",
      "src/main/java/com/example/biblioteca/dto/LibroDTO.java",
      "src/main/java/com/example/biblioteca/repository/LibroRepository.java",
      "src/main/java/com/example/biblioteca/service/LibroService.java",
      "src/main/java/com/example/biblioteca/controller/LibroController.java",
      "src/main/java/com/example/biblioteca/entity/AutorEntity.java",
      "src/main/java/com/example/biblioteca/dto/AutorDTO.java",
      "src/main/java/com/example/biblioteca/repository/AutorRepository.java",
      "src/main/java/com/example/biblioteca/service/AutorService.java",
      "src/main/java/com/example/biblioteca/controller/AutorController.java",
    ]);
  });

  it("es determinista: dos ejecuciones producen el mismo plan", () => {
    const model = canonicalize(fixture("valid-minimal.json"));
    expect(planClassArtifactPaths(model, config)).toEqual(
      planClassArtifactPaths(model, config),
    );
  });

  it("lanza NAME_COLLISION ante clases homónimas en el ámbito raíz", () => {
    const collision: DomainModel = {
      contractVersion: "1",
      id: "m-c",
      name: "M",
      version: "1.0.0",
      classes: [
        { id: "cls-1", name: "Entidad", attributes: [] },
        { id: "cls-2", name: "Entidad", attributes: [] },
      ],
      associations: [],
    };
    expect(() => planClassArtifactPaths(collision, config)).toThrowError(/mismo nombre|NAME_COLLISION/);
  });
});
