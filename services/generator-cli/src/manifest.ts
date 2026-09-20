import type { DomainModel } from "domain-model";
import type { GenerationConfig } from "./config.js";
import { GENERATOR_CONTRACT_VERSION } from "./errors.js";

export interface ManifestFileEntry {
  path: string;
  sha256: string;
}

/**
 * Contenido del `generation-manifest.json` (§5.2). El array `files` va
 * ordenado por `path` ASC y excluye el propio manifiesto. La serialización
 * usa claves en el orden del contrato e indentación fija: el contenido es
 * byte a byte determinista.
 */
export function buildManifest(
  model: DomainModel,
  config: GenerationConfig,
  modelSha256: string,
  files: ManifestFileEntry[],
): string {
  const manifest = {
    generatorContractVersion: GENERATOR_CONTRACT_VERSION,
    generatorVersion: config.generatorVersion,
    templateSetId: config.templateSetId,
    modelId: model.id,
    modelVersion: model.version,
    modelContractVersion: GENERATOR_CONTRACT_VERSION,
    modelSha256,
    basePackage: config.basePackage,
    artifactId: config.artifactId,
    groupId: config.groupId,
    files: [...files].sort((a, b) => (a.path < b.path ? -1 : 1)),
  };
  return JSON.stringify(manifest, null, 2) + "\n";
}
