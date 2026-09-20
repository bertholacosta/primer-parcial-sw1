import { readFileSync } from "node:fs";

const schemaUrl = new URL("./schema/domain-model-v1.schema.json", import.meta.url);

export const domainModelV1Schema: any = JSON.parse(readFileSync(schemaUrl, "utf8"));
