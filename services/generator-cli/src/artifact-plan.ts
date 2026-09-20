import type { DomainModel } from "domain-model";
import type { GenerationConfig } from "./config.js";
import { javaPackageForClass, resolveJavaClassNames } from "./naming.js";

/**
 * Planificación de artefactos de las cinco capas obligatorias (§5.1).
 * Este módulo calcula únicamente las rutas relativas del plan de archivos;
 * el contenido de cada capa se implementa en P2-004.
 */

export const LAYERS = ["entity", "dto", "repository", "service", "controller"] as const;
export type Layer = (typeof LAYERS)[number];

const LAYER_SUFFIX: Record<Layer, string> = {
  entity: "Entity",
  dto: "DTO",
  repository: "Repository",
  service: "Service",
  controller: "Controller",
};

export interface PlannedArtifact {
  /** Ruta relativa POSIX dentro del outputDir (p. ej. `src/main/java/com/x/entity/LibroEntity.java`). */
  relativePath: string;
  layer: Layer;
  classId: string;
  className: string;
}

/**
 * Devuelve el plan de rutas de las cinco capas para cada clase del modelo,
 * en orden canónico de clases (§4.2) y orden fijo de capas (§5.1). El orden
 * resultante es estable: mismo modelo canónico y misma configuración → mismo
 * plan. Puede lanzar NAME_COLLISION (§6.1).
 */
export function planClassArtifactPaths(
  model: DomainModel,
  config: GenerationConfig,
): PlannedArtifact[] {
  const classNames = resolveJavaClassNames(model);
  const plan: PlannedArtifact[] = [];

  for (const cls of model.classes) {
    const className = classNames.get(cls.id) ?? "";
    const packagePath = javaPackageForClass(cls, model, config.basePackage).replace(/\./g, "/");
    for (const layer of LAYERS) {
      plan.push({
        relativePath: `src/main/java/${packagePath}/${layer}/${className}${LAYER_SUFFIX[layer]}.java`,
        layer,
        classId: cls.id,
        className,
      });
    }
  }

  return plan;
}
