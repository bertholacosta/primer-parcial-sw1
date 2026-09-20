import * as fs from "node:fs";
import * as path from "node:path";
import Handlebars from "handlebars";
import type { DomainClass, DomainModel } from "domain-model";
import { javaPackageForClass, restPathForClassName, toLowerCamelCase, toSnakeCase, toUpperCamelCase, resolveJavaClassNames } from "./naming.js";
import type { GenerationConfig } from "./config.js";

function getJavaType(type: string): string {
  switch (type) {
    case "String": return "String";
    case "Integer": return "Integer";
    case "Long": return "Long";
    case "Double": return "Double";
    case "Boolean": return "Boolean";
    case "Date": return "LocalDate";
    case "DateTime": return "LocalDateTime";
    case "UUID": return "UUID";
    default: return type;
  }
}

function getColumnDefinition(type: string): string | null {
  if (type === "String") return "TEXT";
  if (type === "UUID") return "uuid";
  return null;
}

export function buildTemplateContext(model: DomainModel, cls: DomainClass, config: GenerationConfig) {
  const classNames = resolveJavaClassNames(model);
  const className = classNames.get(cls.id) ?? "";
  const packagePath = javaPackageForClass(cls, model, config.basePackage);
  const tableName = toSnakeCase(className);
  const restPath = restPathForClassName(className);

  const idAttr = cls.attributes?.find(a => a.name === "id");
  const hasDefaultId = !idAttr;
  const idJavaType = idAttr ? getJavaType(idAttr.type) : "Long";
  const idImport = idJavaType === "UUID" ? "java.util.UUID" : null;

  const attributes = (cls.attributes ?? []).map(attr => ({
    name: toLowerCamelCase(attr.name),
    capitalizedName: toUpperCamelCase(attr.name),
    javaType: getJavaType(attr.type),
    columnName: toSnakeCase(attr.name),
    columnDefinition: getColumnDefinition(attr.type),
    nullable: attr.multiplicity !== "1",
    isId: attr.name === "id",
    generatedStrategy:
      attr.name !== "id" ? null
      : attr.type === "Long" ? "IDENTITY"
      : attr.type === "UUID" ? "UUID"
      : null,
  }));

  const associations = (model.associations ?? []).filter(a => a.sourceClassId === cls.id || (a.targetClassId === cls.id && a.navigability === "bidirectional")).map(a => {
    const isSource = a.sourceClassId === cls.id;
    const relatedClassId = isSource ? a.targetClassId : a.sourceClassId;
    const relatedClassName = classNames.get(relatedClassId) ?? "";

    // Mapeo de anotaciones (Simplificado para cumplir contrato)
    const srcMult = a.sourceMultiplicity;
    const tgtMult = a.targetMultiplicity;

    let annotation: string;
    let mappedBy = null;
    let isCollection = false;
    let joinColumn = null;
    let joinTable = null;
    let inverseJoinColumn = null;

    if (isSource) {
      if ((srcMult === "1" || srcMult === "0..1") && (tgtMult === "1" || tgtMult === "0..1")) {
        annotation = "@OneToOne";
        joinColumn = a.name ? toSnakeCase(a.name) + "_id" : toSnakeCase(relatedClassName) + "_id";
      } else if ((srcMult === "0..*" || srcMult === "1..*") && (tgtMult === "1" || tgtMult === "0..1")) {
        annotation = "@ManyToOne";
        joinColumn = a.name ? toSnakeCase(a.name) + "_id" : toSnakeCase(relatedClassName) + "_id";
      } else if ((srcMult === "1" || srcMult === "0..1") && (tgtMult === "0..*" || tgtMult === "1..*")) {
        annotation = "@OneToMany";
        isCollection = true;
        joinColumn = a.name ? toSnakeCase(a.name) + "_id" : toSnakeCase(relatedClassName) + "_id";
      } else {
        annotation = "@ManyToMany";
        isCollection = true;
        const t1 = toSnakeCase(className);
        const t2 = toSnakeCase(relatedClassName);
        joinTable = [t1, t2].sort().join("_");
        joinColumn = t1 + "_id";
        inverseJoinColumn = t2 + "_id";
      }
    } else {
      if ((srcMult === "1" || srcMult === "0..1") && (tgtMult === "1" || tgtMult === "0..1")) {
        annotation = "@OneToOne";
        mappedBy = toLowerCamelCase(a.name || className);
      } else if ((srcMult === "0..*" || srcMult === "1..*") && (tgtMult === "1" || tgtMult === "0..1")) {
        annotation = "@OneToMany";
        isCollection = true;
        mappedBy = toLowerCamelCase(a.name || className);
      } else if ((srcMult === "1" || srcMult === "0..1") && (tgtMult === "0..*" || tgtMult === "1..*")) {
        annotation = "@ManyToOne";
      } else {
        annotation = "@ManyToMany";
        isCollection = true;
        mappedBy = toLowerCamelCase(a.name || className) + "s";
      }
    }

    const baseName = isSource ? (a.name || relatedClassName) : relatedClassName;
    const camelName = toLowerCamelCase(baseName);

    return {
      name: isCollection ? camelName + "s" : camelName,
      capitalizedName: toUpperCamelCase(isCollection ? camelName + "s" : camelName),
      javaType: isCollection ? `List<${relatedClassName}Entity>` : `${relatedClassName}Entity`,
      baseJavaType: relatedClassName,
      annotation,
      mappedBy,
      joinColumn,
      joinTable,
      inverseJoinColumn,
      isCollection
    };
  });

  return {
    packagePath,
    className,
    tableName,
    restPath,
    hasDefaultId,
    idJavaType,
    idImport,
    attributes,
    associations
  };
}

// Compilamos las plantillas sincrónicamente en carga (fail-fast)
export function getTemplateEngine(templateDir: string) {
  const templates = {
    entity: Handlebars.compile(fs.readFileSync(path.join(templateDir, "entity.hbs"), "utf-8"), { noEscape: true }),
    dto: Handlebars.compile(fs.readFileSync(path.join(templateDir, "dto.hbs"), "utf-8"), { noEscape: true }),
    repository: Handlebars.compile(fs.readFileSync(path.join(templateDir, "repository.hbs"), "utf-8"), { noEscape: true }),
    service: Handlebars.compile(fs.readFileSync(path.join(templateDir, "service.hbs"), "utf-8"), { noEscape: true }),
    controller: Handlebars.compile(fs.readFileSync(path.join(templateDir, "controller.hbs"), "utf-8"), { noEscape: true }),
    pom: Handlebars.compile(fs.readFileSync(path.join(templateDir, "pom.hbs"), "utf-8"), { noEscape: true }),
    application: Handlebars.compile(fs.readFileSync(path.join(templateDir, "application.hbs"), "utf-8"), { noEscape: true }),
  };

  return {
    render(layer: "entity" | "dto" | "repository" | "service" | "controller" | "pom" | "application", context: Record<string, unknown>): string {
      return templates[layer](context);
    }
  };
}
