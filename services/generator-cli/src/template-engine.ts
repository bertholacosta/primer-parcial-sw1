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
  const tableName = toSnakeCase(cls.name);
  const restPath = restPathForClassName(className);

  const kindOf = (a: { kind?: string }) => a.kind ?? "association";

  // ADR-0009: herencia — padre de esta clase (hija = source de generalization).
  const parentAssoc = (model.associations ?? []).find(
    a => kindOf(a) === "generalization" && a.sourceClassId === cls.id
  );
  const parentClass = parentAssoc ? model.classes.find(c => c.id === parentAssoc.targetClassId) : undefined;
  const extendsClass = parentClass ? `${classNames.get(parentClass.id) ?? ""}Entity` : null;
  const isInheritanceRoot = (model.associations ?? []).some(
    a => kindOf(a) === "generalization" && a.targetClassId === cls.id
  );

  // La hija no redeclara el id: lo hereda del padre (JOINED).
  const ownAttributes = extendsClass
    ? (cls.attributes ?? []).filter(a => a.name !== "id")
    : (cls.attributes ?? []);

  const idAttr = cls.attributes?.find(a => a.name === "id");
  const hasDefaultId = !idAttr && !extendsClass;
  const idJavaType = idAttr ? getJavaType(idAttr.type) : "Long";
  const idImport = idJavaType === "UUID" ? "java.util.UUID" : null;

  const attributes = ownAttributes.map(attr => ({
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

  // ADR-0009: generalization/dependency no generan campos persistentes;
  // associationClass se materializa como @ManyToOne en la clase portadora.
  const structuralAssocs = (model.associations ?? []).filter(
    a => kindOf(a) !== "generalization" && kindOf(a) !== "dependency" && kindOf(a) !== "associationClass"
  );

  const associations = structuralAssocs.filter(a => a.sourceClassId === cls.id || (a.targetClassId === cls.id && a.navigability === "bidirectional")).map(a => {
    const kind = kindOf(a);
    const isSource = a.sourceClassId === cls.id;
    // Composición: ciclo de vida fuerte en el todo (source). Agregación: débil.
    const cascade =
      kind === "composition" && isSource ? "CascadeType.ALL"
      : kind === "aggregation" && isSource ? "{CascadeType.PERSIST, CascadeType.MERGE}"
      : null;
    const orphanRemoval = kind === "composition" && isSource;
    const relatedClassId = isSource ? a.targetClassId : a.sourceClassId;
    const relatedClass = model.classes.find(c => c.id === relatedClassId);
    const relatedClassName = classNames.get(relatedClassId) ?? "";
    const relatedPackage = relatedClass
      ? javaPackageForClass(relatedClass, model, config.basePackage)
      : packagePath;
    const otherPackage = relatedPackage !== packagePath;

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
        if (a.navigability === "bidirectional") {
          mappedBy = toLowerCamelCase(className);
        } else {
          joinColumn = a.name ? toSnakeCase(a.name) + "_id" : toSnakeCase(relatedClassName) + "_id";
        }
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
        joinColumn = a.name ? toSnakeCase(a.name) + "_id" : toSnakeCase(relatedClassName) + "_id";
      } else {
        annotation = "@ManyToMany";
        isCollection = true;
        mappedBy = toLowerCamelCase(a.name || className) + "s";
      }
    }

    const baseName = isSource ? (a.name || relatedClassName) : relatedClassName;
    const camelName = toLowerCamelCase(baseName);

    const params = [
      mappedBy ? `mappedBy = "${mappedBy}"` : null,
      cascade ? `cascade = ${cascade}` : null,
      orphanRemoval ? "orphanRemoval = true" : null,
    ].filter(Boolean).join(", ");
    const annotationFull = params ? `${annotation}(${params})` : annotation;

    return {
      name: isCollection ? camelName + "s" : camelName,
      capitalizedName: toUpperCamelCase(isCollection ? camelName + "s" : camelName),
      javaType: isCollection ? `List<${relatedClassName}Entity>` : `${relatedClassName}Entity`,
      baseJavaType: relatedClassName,
      annotation,
      annotationFull,
      mappedBy,
      joinColumn,
      joinTable,
      inverseJoinColumn,
      isCollection,
      inverse: !isSource,
      entityImport: otherPackage ? `${relatedPackage}.entity.${relatedClassName}Entity` : null,
      dtoImport: otherPackage ? `${relatedPackage}.dto.${relatedClassName}DTO` : null,
      serviceEntityImport: `${relatedPackage}.entity.${relatedClassName}Entity`,
      serviceDtoImport: `${relatedPackage}.dto.${relatedClassName}DTO`,
      relatedClassId,
      relatedClass,
    };
  });

  // Clase-asociación: la clase portadora enlaza ambos extremos con @ManyToOne.
  for (const a of model.associations ?? []) {
    if (kindOf(a) !== "associationClass" || a.associationClassId !== cls.id) continue;
    for (const endClassId of [a.sourceClassId, a.targetClassId]) {
      const endClass = model.classes.find(c => c.id === endClassId);
      const endClassName = classNames.get(endClassId) ?? "";
      if (!endClassName) continue;
      const endPackage = javaPackageForClass(endClass ?? cls, model, config.basePackage);
      const fieldName = `${toLowerCamelCase(endClassName)}End`;
      associations.push({
        name: fieldName,
        capitalizedName: toUpperCamelCase(fieldName),
        javaType: `${endClassName}Entity`,
        baseJavaType: endClassName,
        annotation: "@ManyToOne",
        annotationFull: "@ManyToOne",
        mappedBy: null,
        joinColumn: `${toSnakeCase(a.name || cls.name)}_${toSnakeCase(endClassName)}_id`,
        joinTable: null,
        inverseJoinColumn: null,
        isCollection: false,
        inverse: false,
        entityImport: endPackage !== packagePath ? `${endPackage}.entity.${endClassName}Entity` : null,
        dtoImport: endPackage !== packagePath ? `${endPackage}.dto.${endClassName}DTO` : null,
        serviceEntityImport: `${endPackage}.entity.${endClassName}Entity`,
        serviceDtoImport: `${endPackage}.dto.${endClassName}DTO`,
        relatedClassId: endClassId,
        relatedClass: endClass,
      });
    }
  }

  // Import del padre cuando la herencia cruza paquetes.
  const extendsImport = parentClass
    ? (() => {
        const pp = javaPackageForClass(parentClass, model, config.basePackage);
        return pp !== packagePath ? `${pp}.entity.${extendsClass}` : null;
      })()
    : null;

  const nonNull = (xs: (string | null)[]): string[] =>
    xs.filter((x): x is string => x !== null);

  const entityImports = [...new Set(nonNull([...associations.map(x => x.entityImport), extendsImport]))].sort();
  const dtoImports = [...new Set([
    ...nonNull(associations.map(x => x.dtoImport)),
    ...(associations.some(x => x.inverse) ? ["com.fasterxml.jackson.annotation.JsonIgnore"] : []),
  ])].sort();
  const serviceImports = [...new Set(associations.flatMap(x => [x.serviceEntityImport, x.serviceDtoImport]))].sort();

  const seenRelated = new Set<string>();
  const relatedTypes = [];
  for (const assoc of associations) {
    if (seenRelated.has(assoc.relatedClassId)) continue;
    seenRelated.add(assoc.relatedClassId);
    const relAttrs = assoc.relatedClass?.attributes ?? [];
    const relHasDefaultId = !relAttrs.some(at => at.name === "id");
    relatedTypes.push({
      className: assoc.baseJavaType,
      accessors: [
        ...(relHasDefaultId ? ["Id"] : []),
        ...relAttrs.map(at => toUpperCamelCase(at.name)),
      ],
    });
  }

  return {
    packagePath,
    className,
    tableName,
    restPath,
    extendsClass,
    isInheritanceRoot,
    hasDefaultId,
    idJavaType,
    idImport,
    attributes,
    associations,
    entityImports,
    dtoImports,
    serviceImports,
    relatedTypes,
  };
}

function readTemplate(filePath: string): string {
  return fs.readFileSync(filePath, "utf-8").replace(/\r\n/g, "\n");
}

// Compilamos las plantillas sincrónicamente en carga (fail-fast)
export function getTemplateEngine(templateDir: string) {
  const templates = {
    entity: Handlebars.compile(readTemplate(path.join(templateDir, "entity.hbs")), { noEscape: true }),
    dto: Handlebars.compile(readTemplate(path.join(templateDir, "dto.hbs")), { noEscape: true }),
    repository: Handlebars.compile(readTemplate(path.join(templateDir, "repository.hbs")), { noEscape: true }),
    service: Handlebars.compile(readTemplate(path.join(templateDir, "service.hbs")), { noEscape: true }),
    controller: Handlebars.compile(readTemplate(path.join(templateDir, "controller.hbs")), { noEscape: true }),
    pom: Handlebars.compile(readTemplate(path.join(templateDir, "pom.hbs")), { noEscape: true }),
    application: Handlebars.compile(readTemplate(path.join(templateDir, "application.hbs")), { noEscape: true }),
    applicationClass: Handlebars.compile(readTemplate(path.join(templateDir, "applicationClass.hbs")), { noEscape: true }),
  };

  return {
    render(layer: "entity" | "dto" | "repository" | "service" | "controller" | "pom" | "application" | "applicationClass", context: Record<string, unknown>): string {
      return templates[layer](context);
    }
  };
}
