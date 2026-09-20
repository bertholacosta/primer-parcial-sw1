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
    // §6.2: {basePackage}.{paquetes del modelo}; la clase está en el paquete
    // "biblioteca" del modelo, por lo que el segmento aparece tras el basePackage.
    expect(paths).toEqual([
      "src/main/java/com/example/biblioteca/biblioteca/entity/LibroEntity.java",
      "src/main/java/com/example/biblioteca/biblioteca/dto/LibroDTO.java",
      "src/main/java/com/example/biblioteca/biblioteca/repository/LibroRepository.java",
      "src/main/java/com/example/biblioteca/biblioteca/service/LibroService.java",
      "src/main/java/com/example/biblioteca/biblioteca/controller/LibroController.java",
      "src/main/java/com/example/biblioteca/biblioteca/entity/AutorEntity.java",
      "src/main/java/com/example/biblioteca/biblioteca/dto/AutorDTO.java",
      "src/main/java/com/example/biblioteca/biblioteca/repository/AutorRepository.java",
      "src/main/java/com/example/biblioteca/biblioteca/service/AutorService.java",
      "src/main/java/com/example/biblioteca/biblioteca/controller/AutorController.java",
    ]);
  });

  it("es determinista: dos ejecuciones producen el mismo plan", () => {
    const model = canonicalize(fixture("valid-minimal.json"));
    expect(planClassArtifactPaths(model, config)).toEqual(
      planClassArtifactPaths(model, config),
    );
  });

  it("desambigüa nombres de clase colisionados por paquete", () => {
    const model = canonicalize(fixture("valid-duplicate-class-names-different-packages.json"));
    const paths = planClassArtifactPaths(model, config).map((a) => a.relativePath);
    expect(paths).toContain(
      "src/main/java/com/example/biblioteca/a/entity/AEntidadEntity.java",
    );
    expect(paths).toContain(
      "src/main/java/com/example/biblioteca/b/entity/BEntidadEntity.java",
    );
  });
});
