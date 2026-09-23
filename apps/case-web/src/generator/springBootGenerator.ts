/**
 * Generador Spring Boot determinista.
 * Convierte un CanonicalDomainModel en un ZIP descargable con las cinco capas
 * (Entity, DTO, Repository, Service, Controller) + pom.xml + application.yml.
 *
 * Sin dependencias externas de template: usa template literals de TS.
 * Usa JSZip para empaquetar los archivos.
 */

import JSZip from 'jszip';
import type { CanonicalDomainModel, CanonicalClass } from '../domain/model';

const PK_PREFIX = '[PK]';
const FK_PREFIX = '[FK]';

// ─── Helpers ────────────────────────────────────────────────────────────────

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

/**
 * Divide un nombre del modelo en palabras alfanuméricas ASCII: corta en
 * espacios/guiones/underscores y fronteras camelCase, y elimina acentos
 * (NFD). Garantiza que los identificadores Java/Maven/SQL generados sean
 * válidos aunque el nombre del modelo tenga espacios o tildes.
 */
function normalizeWords(s: string): string[] {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean);
}

function toPascalCase(s: string): string {
  return normalizeWords(s).map((w) => capitalize(w.toLowerCase())).join('');
}

/** Identificador Java válido (lowerCamelCase) para campos, paquetes y variables. */
function javaId(s: string): string {
  const words = normalizeWords(s);
  return words.length === 0
    ? 'unnamed'
    : words[0].toLowerCase() + words.slice(1).map((w) => capitalize(w.toLowerCase())).join('');
}

function toSnakeCase(s: string): string {
  return normalizeWords(s).map((w) => w.toLowerCase()).join('_');
}

function toKebabCase(s: string): string {
  return normalizeWords(s).map((w) => w.toLowerCase()).join('-');
}

const JAVA_TYPE_MAP: Record<string, string> = {
  String: 'String',
  Integer: 'Integer',
  Long: 'Long',
  Double: 'Double',
  Boolean: 'Boolean',
  Date: 'LocalDate',
  DateTime: 'LocalDateTime',
  UUID: 'UUID',
};

function toJavaType(canonicalType: string): string {
  return JAVA_TYPE_MAP[canonicalType] ?? 'String';
}

function parseAttrMeta(description?: string) {
  const s = description ?? '';
  return {
    isPk: s.includes(PK_PREFIX),
    isFk: s.includes(FK_PREFIX),
  };
}

// ─── Validación previa a la exportación ──────────────────────────────────────

export interface SpringBootDiagnostic {
  severity: 'ERROR' | 'WARNING';
  code: string;
  message: string;
}

/** Lanzada cuando el modelo produciría código que no compila o rompe JPA. */
export class SpringBootValidationError extends Error {
  constructor(public readonly diagnostics: SpringBootDiagnostic[]) {
    super(diagnostics.map((d) => `[${d.code}] ${d.message}`).join('\n'));
    this.name = 'SpringBootValidationError';
  }
}

const JAVA_RESERVED = new Set([
  'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char',
  'class', 'const', 'continue', 'default', 'do', 'double', 'else', 'enum',
  'extends', 'final', 'finally', 'float', 'for', 'goto', 'if', 'implements',
  'import', 'instanceof', 'int', 'interface', 'long', 'native', 'new',
  'package', 'private', 'protected', 'public', 'return', 'short', 'static',
  'strictfp', 'super', 'switch', 'synchronized', 'this', 'throw', 'throws',
  'transient', 'try', 'void', 'volatile', 'while', 'true', 'false', 'null',
]);

const PK_GENERABLE_TYPES = new Set(['Integer', 'Long', 'UUID']);

/**
 * Validación determinista previa a la generación (MP/PROJECT: solo reglas
 * validables modifican el modelo o generan código). Devuelve diagnósticos;
 * cualquier ERROR implica que el proyecto generado no compilaría o fallaría
 * al arrancar Hibernate, por lo que la exportación debe bloquearse.
 */
export function validateSpringBootModel(
  model: CanonicalDomainModel,
  options: SpringBootGeneratorOptions = {}
): SpringBootDiagnostic[] {
  const diagnostics: SpringBootDiagnostic[] = [];
  const err = (code: string, message: string) =>
    diagnostics.push({ severity: 'ERROR', code, message });
  const warn = (code: string, message: string) =>
    diagnostics.push({ severity: 'WARNING', code, message });

  const artifactId = options.artifactId ?? toKebabCase(model.name);
  const groupId = options.groupId ?? `com.example.${javaId(model.name)}`;

  if (!artifactId) {
    err('INVALID_MODEL_NAME', `El nombre del modelo "${model.name}" no produce un artifactId Maven válido.`);
  }
  for (const seg of groupId.split('.')) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(seg) || JAVA_RESERVED.has(seg.toLowerCase())) {
      err('INVALID_GROUP_ID', `El segmento "${seg}" del groupId "${groupId}" no es un identificador Java válido.`);
      break;
    }
  }
  if (model.classes.length === 0) {
    err('EMPTY_MODEL', 'El modelo no contiene clases; no hay nada que generar.');
  }

  const classIds = new Set(model.classes.map((c) => c.id));
  const seenClass = new Map<string, string>();
  // Registro global de columnas por tabla: la FK de un @ManyToOne cae en la
  // tabla propia, pero la de un @OneToMany unidireccional cae en la hija.
  const tableColumns = new Map<string, Map<string, string>>();
  const joinTables = new Map<string, string>();
  const addColumn = (table: string, column: string, owner: string) => {
    const cols = tableColumns.get(table) ?? new Map<string, string>();
    tableColumns.set(table, cols);
    const prev = cols.get(column);
    if (prev) {
      err('FK_COLUMN_COLLISION', `La columna "${column}" de la tabla "${table}" la generan dos veces: ${prev} y ${owner}.`);
    } else {
      cols.set(column, owner);
    }
  };

  const ctxByClass = new Map<string, GeneratedClass>();
  for (const cls of model.classes) {
    const pascal = toPascalCase(cls.name);
    if (!pascal) {
      err('INVALID_CLASS_NAME', `La clase "${cls.name}" no produce un nombre Java válido.`);
      continue;
    }
    const prevName = seenClass.get(pascal.toLowerCase());
    if (prevName) {
      err('DUPLICATE_CLASS_NAME', `Las clases "${prevName}" y "${cls.name}" generan el mismo tipo "${pascal}".`);
    }
    seenClass.set(pascal.toLowerCase(), cls.name);
    if (JAVA_RESERVED.has(javaId(cls.name))) {
      err('RESERVED_IDENTIFIER', `El nombre de clase "${cls.name}" genera el identificador reservado "${javaId(cls.name)}".`);
    }

    const ctx = buildClassContext(cls, model, groupId);
    ctxByClass.set(cls.id, ctx);
    const seenField = new Map<string, string>();
    if (ctx.hasDefaultId) {
      seenField.set('id', 'el id autogenerado');
      addColumn(ctx.tableName, 'id', `el id autogenerado de ${cls.name}`);
    }

    let pkCount = 0;
    cls.attributes.forEach((raw, i) => {
      const a = ctx.attributes[i];
      if (!a || normalizeWords(raw.name).length === 0) {
        err('INVALID_ATTRIBUTE_NAME', `El atributo "${raw.name}" de ${cls.name} no produce un nombre Java válido.`);
        return;
      }
      const meta = parseAttrMeta(raw.description);
      if (a.isId) {
        pkCount++;
        if (!PK_GENERABLE_TYPES.has(a.javaType)) {
          err('INVALID_PK_TYPE', `El [PK] "${raw.name}" de ${cls.name} es ${raw.type}; la clave autogenerada solo admite Integer, Long o UUID.`);
        }
      }
      if (JAVA_RESERVED.has(a.name)) {
        err('RESERVED_IDENTIFIER', `El atributo "${raw.name}" de ${cls.name} genera el identificador reservado "${a.name}".`);
      }
      const fieldOwner = seenField.get(a.name);
      if (fieldOwner) {
        const code = fieldOwner === 'el id autogenerado' ? 'ID_FIELD_COLLISION' : 'DUPLICATE_FIELD';
        err(code, `El atributo "${raw.name}" de ${cls.name} choca con ${fieldOwner} (campo "${a.name}").`);
      }
      seenField.set(a.name, `el atributo "${raw.name}"`);
      addColumn(ctx.tableName, a.columnName, `el atributo "${raw.name}" de ${cls.name}`);
      if (meta.isFk) {
        warn('FK_MARKER_IGNORED', `El atributo "${raw.name}" de ${cls.name} lleva [FK]: las llaves foráneas se derivan de las asociaciones, no de atributos.`);
      }
    });
    if (pkCount > 1) {
      err('MULTIPLE_PK', `La clase ${cls.name} tiene ${pkCount} atributos [PK]; las claves compuestas no están soportadas.`);
    }
  }

  // Segunda pasada: campos y columnas que aportan las asociaciones.
  for (const cls of model.classes) {
    const ctx = ctxByClass.get(cls.id);
    if (!ctx) continue;
    const seenField = new Map<string, string>();
    ctx.attributes.forEach((a) => seenField.set(a.name, `el atributo "${a.name}"`));
    if (ctx.hasDefaultId) seenField.set('id', 'el id autogenerado');

    for (const a of ctx.associations) {
      const fieldOwner = seenField.get(a.name);
      if (fieldOwner) {
        err('DUPLICATE_FIELD', `La relación de ${cls.name} hacia ${a.baseJavaType} genera el campo "${a.name}", que choca con ${fieldOwner}.`);
      }
      seenField.set(a.name, `la relación "${a.name}"`);

      if (a.joinTable) {
        const prev = joinTables.get(a.joinTable);
        if (prev) {
          err('DUPLICATE_JOIN_TABLE', `Las relaciones ${prev} y "${a.name}" generan la misma tabla intermedia "${a.joinTable}".`);
        } else {
          joinTables.set(a.joinTable, `"${a.name}"`);
        }
      } else if (a.joinColumn) {
        // @ManyToOne → FK en la tabla propia; @OneToMany unidireccional → FK en la hija
        const hostTable = a.isCollection ? a.targetTableName : ctx.tableName;
        const hostName = a.isCollection ? a.baseJavaType : ctx.pascalName;
        addColumn(hostTable, a.joinColumn, `la relación "${a.name}" de ${cls.name} (FK en "${hostName}")`);
      }
    }
  }

  for (const assoc of model.associations) {
    if (!classIds.has(assoc.sourceClassId) || !classIds.has(assoc.targetClassId)) {
      err('DANGLING_ASSOCIATION', `La relación "${assoc.name ?? assoc.id}" referencia una clase inexistente.`);
    }
    if (assoc.kind === 'generalization') {
      warn('GENERALIZATION_NOT_GENERATED', `La herencia "${assoc.name ?? assoc.id}" no se refleja en el código generado.`);
    }
    if (assoc.kind === 'associationClass') {
      const carrier = model.classes.find((c) => c.id === assoc.associationClassId);
      if (!assoc.associationClassId || !carrier) {
        err('MISSING_ASSOC_CLASS', `La clase-asociación "${assoc.name ?? assoc.id}" no tiene clase portadora válida.`);
      }
    }
  }

  return diagnostics;
}

interface GeneratedClass {
  name: string;
  pascalName: string;
  tableName: string;
  packagePath: string;
  groupId: string;
  artifactId: string;
  /** Atributos normales (sin PK explícita → usa id auto) */
  attributes: AttrCtx[];
  /** Si tiene algún atributo marcado [PK] */
  hasExplicitPk: boolean;
  /** Si no tiene PK explícita, se genera id Long automático */
  hasDefaultId: boolean;
  idJavaType: string;
  idImport: string;
  associations: AssocCtx[];
  relatedTypes: RelatedType[];
}

interface AttrCtx {
  name: string;
  capitalizedName: string;
  javaType: string;
  columnName: string;
  nullable: boolean;
  isId: boolean;
  generatedStrategy: string;
  columnDefinition: string;
}

interface AssocCtx {
  name: string;
  capitalizedName: string;
  annotationFull: string;
  javaType: string;
  baseJavaType: string;
  /** Paquete de la clase destino (para imports cruzados entre capas). */
  targetPackage: string;
  /** Tabla de la clase destino (donde cae la FK de un OneToMany unidireccional). */
  targetTableName: string;
  joinColumn: string;
  joinTable: string;
  inverseJoinColumn: string;
  isCollection: boolean;
  inverse: boolean;
}

interface RelatedType {
  className: string;
  packagePath: string;
  accessors: string[];
}

// ─── Contexto de clase ───────────────────────────────────────────────────────

function buildClassContext(
  cls: CanonicalClass,
  model: CanonicalDomainModel,
  groupId: string
): GeneratedClass {
  const pascalName = toPascalCase(cls.name);
  const packagePath = groupId;

  // Atributos
  const attrCtxList: AttrCtx[] = cls.attributes.map((attr) => {
    const meta = parseAttrMeta(attr.description);
    const javaType = toJavaType(attr.type);
    return {
      name: javaId(attr.name),
      capitalizedName: toPascalCase(attr.name),
      javaType,
      columnName: toSnakeCase(attr.name),
      nullable: attr.nullable,
      isId: meta.isPk,
      generatedStrategy: meta.isPk ? (attr.type === 'UUID' ? 'UUID' : 'IDENTITY') : '',
      columnDefinition: '',
    };
  });

  const hasExplicitPk = attrCtxList.some((a) => a.isId);
  const hasDefaultId = !hasExplicitPk;

  // PK type para Repository/Service/Controller
  let idJavaType = 'Long';
  let idImport = '';
  if (hasExplicitPk) {
    const pkAttr = attrCtxList.find((a) => a.isId)!;
    idJavaType = pkAttr.javaType;
    if (idJavaType === 'UUID') idImport = 'java.util.UUID';
  }

  // Asociaciones: solo procesa las que tienen esta clase como source
  const outgoing = model.associations.filter((a) => a.sourceClassId === cls.id);

  const assocCtxList: AssocCtx[] = [];
  const relatedTypeMap = new Map<string, RelatedType>();

  for (const assoc of outgoing) {
    const targetClass = model.classes.find((c) => c.id === assoc.targetClassId);
    if (!targetClass) continue;

    const targetPascal = toPascalCase(targetClass.name);
    const targetPackage = groupId;
    const isCollection = assoc.targetMultiplicity.includes('*');
    const kind = assoc.kind ?? 'association';
    const isOwner = true;

    let annotationFull = '';
    let javaType = '';
    let joinColumn = toSnakeCase(cls.name) + '_id';
    let joinTable = '';
    let inverseJoinColumn = toSnakeCase(targetClass.name) + '_id';

    if (kind === 'generalization') {
      // generalization se maneja en extends, no como campo
      continue;
    }

    if (isCollection) {
      const sourceMany = assoc.sourceMultiplicity.includes('*');
      const reverse = model.associations.find(
        (a) => a.sourceClassId === assoc.targetClassId && a.targetClassId === cls.id
      );
      if (sourceMany) {
        // N:M real → tabla intermedia
        annotationFull = `@ManyToMany`;
        joinTable = `${toSnakeCase(cls.name)}_${toSnakeCase(targetClass.name)}`;
      } else if (reverse && !reverse.targetMultiplicity.includes('*')) {
        // Bidireccional 1:N: el lado * apunta por mappedBy al @ManyToOne del hijo
        annotationFull = `@OneToMany(mappedBy = "${javaId(cls.name)}", cascade = CascadeType.ALL)`;
        joinColumn = '';
      } else {
        // Unidireccional 1:N: FK en la tabla hija vía @JoinColumn
        const cascade = kind === 'composition' || kind === 'aggregation' ? '(cascade = CascadeType.ALL)' : '';
        annotationFull = `@OneToMany${cascade}`;
      }
      javaType = `List<${targetPascal}Entity>`;
    } else {
      if (kind === 'composition' || kind === 'aggregation') {
        annotationFull = `@ManyToOne`;
      } else {
        annotationFull = `@ManyToOne`;
      }
      javaType = `${targetPascal}Entity`;
      joinColumn = toSnakeCase(targetClass.name) + '_id';
      joinTable = '';
    }

    const fieldName = isCollection
      ? javaId(targetClass.name) + 'List'
      : javaId(targetClass.name);

    assocCtxList.push({
      name: fieldName,
      capitalizedName: capitalize(fieldName),
      annotationFull,
      javaType,
      baseJavaType: targetPascal,
      targetPackage,
      targetTableName: toSnakeCase(targetClass.name),
      joinColumn,
      joinTable,
      inverseJoinColumn,
      isCollection,
      inverse: !isOwner,
    });

    // Agregar tipo relacionado para shallow copy en Service. Si el destino
    // usa el id Long autogenerado, se copia también para que la relación
    // referencie la fila existente en lugar de insertar un duplicado.
    if (!relatedTypeMap.has(targetPascal)) {
      const targetHasExplicitPk = targetClass.attributes.some((a) =>
        (a.description ?? '').includes(PK_PREFIX)
      );
      const targetAttrs = targetClass.attributes.map((a) => toPascalCase(a.name));
      relatedTypeMap.set(targetPascal, {
        className: targetPascal,
        packagePath: targetPackage,
        accessors: targetHasExplicitPk ? targetAttrs : ['Id', ...targetAttrs],
      });
    }
  }

  return {
    name: cls.name,
    pascalName,
    tableName: toSnakeCase(cls.name),
    packagePath,
    groupId,
    artifactId: toKebabCase(cls.name),
    attributes: attrCtxList,
    hasExplicitPk,
    hasDefaultId,
    idJavaType,
    idImport,
    associations: assocCtxList,
    relatedTypes: [...relatedTypeMap.values()],
  };
}

// ─── Templates ──────────────────────────────────────────────────────────────

function genEntity(ctx: GeneratedClass): string {
  const attrs = ctx.attributes.map((a) => {
    const lines: string[] = [];
    if (a.isId) {
      lines.push(`    @Id`);
      if (a.generatedStrategy) lines.push(`    @GeneratedValue(strategy = GenerationType.${a.generatedStrategy})`);
    }
    const nullablePart = a.nullable ? '' : ', nullable = false';
    lines.push(`    @Column(name = "${a.columnName}"${nullablePart})`);
    lines.push(`    private ${a.javaType} ${a.name};`);
    return lines.join('\n');
  }).join('\n\n');

  const assocFields = ctx.associations.map((a) => {
    const lines: string[] = [`    ${a.annotationFull}`];
    if (!a.joinTable && a.joinColumn) lines.push(`    @JoinColumn(name = "${a.joinColumn}")`);
    if (a.joinTable) {
      lines.push(`    @JoinTable(\n        name = "${a.joinTable}",\n        joinColumns = @JoinColumn(name = "${a.joinColumn}"),\n        inverseJoinColumns = @JoinColumn(name = "${a.inverseJoinColumn}")\n    )`);
    }
    lines.push(`    private ${a.javaType} ${a.name};`);
    return lines.join('\n');
  }).join('\n\n');

  const defaultIdBlock = ctx.hasDefaultId ? `
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
` : '';

  const gettersSetters = ctx.attributes.map((a) =>
    `    public ${a.javaType} get${a.capitalizedName}() { return ${a.name}; }\n    public void set${a.capitalizedName}(${a.javaType} ${a.name}) { this.${a.name} = ${a.name}; }`
  ).join('\n');

  const assocGetSet = ctx.associations.map((a) =>
    `    public ${a.javaType} get${a.capitalizedName}() { return ${a.name}; }\n    public void set${a.capitalizedName}(${a.javaType} ${a.name}) { this.${a.name} = ${a.name}; }`
  ).join('\n');

  const defaultIdGS = ctx.hasDefaultId ? `    public Long getId() { return id; }\n    public void setId(Long id) { this.id = id; }` : '';

  return `package ${ctx.packagePath}.entity;

import jakarta.persistence.*;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.UUID;
import java.util.List;
@Entity
@Table(name = "${ctx.tableName}")
public class ${ctx.pascalName}Entity {
${defaultIdBlock}
${attrs}

${assocFields}

    public ${ctx.pascalName}Entity() {}

${defaultIdGS}
${gettersSetters}
${assocGetSet}
}
`;
}

function genDTO(ctx: GeneratedClass): string {
  const fields = ctx.attributes.map((a) => `    private ${a.javaType} ${a.name};`).join('\n');
  const assocFields = ctx.associations.map((a) =>
    a.isCollection
      ? `    private List<${a.baseJavaType}DTO> ${a.name};`
      : `    private ${a.baseJavaType}DTO ${a.name};`
  ).join('\n');

  const defaultId = ctx.hasDefaultId ? '    private Long id;\n' : '';
  const defaultIdGS = ctx.hasDefaultId ? `    public Long getId() { return id; }\n    public void setId(Long id) { this.id = id; }\n` : '';

  const gettersSetters = ctx.attributes.map((a) =>
    `    public ${a.javaType} get${a.capitalizedName}() { return ${a.name}; }\n    public void set${a.capitalizedName}(${a.javaType} ${a.name}) { this.${a.name} = ${a.name}; }`
  ).join('\n');

  const assocGetSet = ctx.associations.map((a) =>
    a.isCollection
      ? `    public List<${a.baseJavaType}DTO> get${a.capitalizedName}() { return ${a.name}; }\n    public void set${a.capitalizedName}(List<${a.baseJavaType}DTO> ${a.name}) { this.${a.name} = ${a.name}; }`
      : `    public ${a.baseJavaType}DTO get${a.capitalizedName}() { return ${a.name}; }\n    public void set${a.capitalizedName}(${a.baseJavaType}DTO ${a.name}) { this.${a.name} = ${a.name}; }`
  ).join('\n');

  return `package ${ctx.packagePath}.dto;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.UUID;
import java.util.List;
public class ${ctx.pascalName}DTO {

${defaultId}${fields}
${assocFields}

    public ${ctx.pascalName}DTO() {}

${defaultIdGS}${gettersSetters}
${assocGetSet}
}
`;
}

function genRepository(ctx: GeneratedClass): string {
  const idImport = ctx.idImport ? `import ${ctx.idImport};\n` : '';
  return `package ${ctx.packagePath}.repository;

import ${ctx.packagePath}.entity.${ctx.pascalName}Entity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
${idImport}
@Repository
public interface ${ctx.pascalName}Repository extends JpaRepository<${ctx.pascalName}Entity, ${ctx.idJavaType}> {
}
`;
}

function genService(ctx: GeneratedClass): string {
  const idImport = ctx.idImport ? `import ${ctx.idImport};\n` : '';

  const toDTOAttrs = ctx.attributes.map((a) =>
    `        dto.set${a.capitalizedName}(entity.get${a.capitalizedName}());`
  ).join('\n');

  const toDTOAssocs = ctx.associations.map((a) =>
    a.isCollection
      ? `        dto.set${a.capitalizedName}(entity.get${a.capitalizedName}() == null ? null : entity.get${a.capitalizedName}().stream().map(this::to${a.baseJavaType}DTOShallow).toList());`
      : `        dto.set${a.capitalizedName}(entity.get${a.capitalizedName}() == null ? null : to${a.baseJavaType}DTOShallow(entity.get${a.capitalizedName}()));`
  ).join('\n');

  const toEntityAttrs = ctx.attributes.map((a) =>
    `        entity.set${a.capitalizedName}(dto.get${a.capitalizedName}());`
  ).join('\n');

  const toEntityAssocs = ctx.associations.map((a) =>
    a.isCollection
      ? `        entity.set${a.capitalizedName}(dto.get${a.capitalizedName}() == null ? null : dto.get${a.capitalizedName}().stream().map(this::to${a.baseJavaType}EntityShallow).collect(Collectors.toList()));`
      : `        entity.set${a.capitalizedName}(dto.get${a.capitalizedName}() == null ? null : to${a.baseJavaType}EntityShallow(dto.get${a.capitalizedName}()));`
  ).join('\n');

  // En update no se copia el id ni la PK: la entidad existente manda.
  const updateAttrs = ctx.attributes.filter((a) => !a.isId).map((a) =>
    `            existing.set${a.capitalizedName}(dto.get${a.capitalizedName}());`
  ).join('\n');

  const updateAssocs = ctx.associations.map((a) =>
    a.isCollection
      ? `            existing.set${a.capitalizedName}(dto.get${a.capitalizedName}() == null ? null : dto.get${a.capitalizedName}().stream().map(this::to${a.baseJavaType}EntityShallow).collect(Collectors.toList()));`
      : `            existing.set${a.capitalizedName}(dto.get${a.capitalizedName}() == null ? null : to${a.baseJavaType}EntityShallow(dto.get${a.capitalizedName}()));`
  ).join('\n');

  const defaultIdDTO = ctx.hasDefaultId ? '        dto.setId(entity.getId());' : '';
  const defaultIdEntity = ctx.hasDefaultId ? '        entity.setId(dto.getId());' : '';

  const shallowMethods = ctx.relatedTypes.map((rt) => {
    const accessors = rt.accessors.map((a) => `        dto.set${a}(entity.get${a}());`).join('\n');
    const entityAccessors = rt.accessors.map((a) => `        entity.set${a}(dto.get${a}());`).join('\n');
    return `
    private ${rt.className}DTO to${rt.className}DTOShallow(${rt.className}Entity entity) {
        ${rt.className}DTO dto = new ${rt.className}DTO();
${accessors}
        return dto;
    }

    private ${rt.className}Entity to${rt.className}EntityShallow(${rt.className}DTO dto) {
        ${rt.className}Entity entity = new ${rt.className}Entity();
${entityAccessors}
        return entity;
    }`;
  }).join('\n');

  const relatedImports = ctx.relatedTypes
    .flatMap((rt) => [
      `import ${rt.packagePath}.dto.${rt.className}DTO;`,
      `import ${rt.packagePath}.entity.${rt.className}Entity;`,
    ])
    .join('\n');

  return `package ${ctx.packagePath}.service;

import ${ctx.packagePath}.dto.${ctx.pascalName}DTO;
import ${ctx.packagePath}.entity.${ctx.pascalName}Entity;
import ${ctx.packagePath}.repository.${ctx.pascalName}Repository;
import org.springframework.stereotype.Service;
import java.util.List;
import java.util.Optional;
import java.util.stream.Collectors;
${idImport}${relatedImports}
@Service
public class ${ctx.pascalName}Service {

    private final ${ctx.pascalName}Repository repository;

    public ${ctx.pascalName}Service(${ctx.pascalName}Repository repository) {
        this.repository = repository;
    }

    public List<${ctx.pascalName}DTO> findAll() {
        return repository.findAll().stream().map(this::toDTO).toList();
    }

    public Optional<${ctx.pascalName}DTO> findById(${ctx.idJavaType} id) {
        return repository.findById(id).map(this::toDTO);
    }

    public ${ctx.pascalName}DTO save(${ctx.pascalName}DTO dto) {
        return toDTO(repository.save(toEntity(dto)));
    }

    public Optional<${ctx.pascalName}DTO> update(${ctx.idJavaType} id, ${ctx.pascalName}DTO dto) {
        return repository.findById(id).map(existing -> {
${updateAttrs}
${updateAssocs}
            return toDTO(repository.save(existing));
        });
    }

    public void deleteById(${ctx.idJavaType} id) {
        repository.deleteById(id);
    }

    private ${ctx.pascalName}DTO toDTO(${ctx.pascalName}Entity entity) {
        ${ctx.pascalName}DTO dto = new ${ctx.pascalName}DTO();
${defaultIdDTO}
${toDTOAttrs}
${toDTOAssocs}
        return dto;
    }

    private ${ctx.pascalName}Entity toEntity(${ctx.pascalName}DTO dto) {
        ${ctx.pascalName}Entity entity = new ${ctx.pascalName}Entity();
${defaultIdEntity}
${toEntityAttrs}
${toEntityAssocs}
        return entity;
    }
${shallowMethods}
}
`;
}

function genController(ctx: GeneratedClass): string {
  const idImport = ctx.idImport ? `import ${ctx.idImport};\n` : '';
  const restPath = `/${toKebabCase(ctx.name)}s`;
  return `package ${ctx.packagePath}.controller;

import ${ctx.packagePath}.dto.${ctx.pascalName}DTO;
import ${ctx.packagePath}.service.${ctx.pascalName}Service;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.List;
${idImport}
@RestController
@RequestMapping("${restPath}")
public class ${ctx.pascalName}Controller {

    private final ${ctx.pascalName}Service service;

    public ${ctx.pascalName}Controller(${ctx.pascalName}Service service) {
        this.service = service;
    }

    @GetMapping
    public List<${ctx.pascalName}DTO> getAll() {
        return service.findAll();
    }

    @GetMapping("/{id}")
    public ResponseEntity<${ctx.pascalName}DTO> getById(@PathVariable ${ctx.idJavaType} id) {
        return service.findById(id)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    @PostMapping
    public ${ctx.pascalName}DTO create(@RequestBody ${ctx.pascalName}DTO dto) {
        return service.save(dto);
    }

    @PutMapping("/{id}")
    public ResponseEntity<${ctx.pascalName}DTO> update(@PathVariable ${ctx.idJavaType} id, @RequestBody ${ctx.pascalName}DTO dto) {
        return service.update(id, dto)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable ${ctx.idJavaType} id) {
        service.deleteById(id);
        return ResponseEntity.noContent().build();
    }
}
`;
}

function genPom(groupId: string, artifactId: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>

    <groupId>${groupId}</groupId>
    <artifactId>${artifactId}</artifactId>
    <version>1.0.0-SNAPSHOT</version>

    <parent>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-parent</artifactId>
        <version>3.3.0</version>
        <relativePath/>
    </parent>

    <properties>
        <java.version>17</java.version>
    </properties>

    <dependencies>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-data-jpa</artifactId>
        </dependency>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-web</artifactId>
        </dependency>
        <dependency>
            <groupId>org.postgresql</groupId>
            <artifactId>postgresql</artifactId>
            <scope>runtime</scope>
        </dependency>
        <dependency>
            <groupId>com.fasterxml.jackson.core</groupId>
            <artifactId>jackson-annotations</artifactId>
        </dependency>
    </dependencies>

    <build>
        <plugins>
            <plugin>
                <groupId>org.springframework.boot</groupId>
                <artifactId>spring-boot-maven-plugin</artifactId>
            </plugin>
        </plugins>
    </build>
</project>
`;
}

function genApplicationYml(artifactId: string): string {
  return `spring:
  application:
    name: ${artifactId}
  datasource:
    url: jdbc:postgresql://localhost:5432/${artifactId.replace(/-/g, '_')}
    username: postgres
    password: postgres
    driver-class-name: org.postgresql.Driver
  jpa:
    hibernate:
      ddl-auto: update
    show-sql: true
    properties:
      hibernate:
        dialect: org.hibernate.dialect.PostgreSQLDialect

server:
  port: 8080
`;
}

function genDockerfile(): string {
  return `# Build multi-stage: compila con Maven y empaqueta en una imagen JRE mínima.
FROM maven:3.9-eclipse-temurin-17 AS build
WORKDIR /app
COPY pom.xml .
RUN mvn -q -B dependency:go-offline
COPY src ./src
RUN mvn -q -B package -DskipTests

FROM eclipse-temurin:17-jre
WORKDIR /app
COPY --from=build /app/target/*.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
`;
}

function genDockerCompose(artifactId: string): string {
  const dbName = artifactId.replace(/-/g, '_');
  return `services:
  db:
    image: postgres:16
    container_name: ${artifactId}-db
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: ${dbName}
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 3s
      retries: 10

  app:
    build: .
    container_name: ${artifactId}-app
    ports:
      - "8080:8080"
    environment:
      # En compose la BD se resuelve por el nombre del servicio "db"
      SPRING_DATASOURCE_URL: jdbc:postgresql://db:5432/${dbName}
      SPRING_DATASOURCE_USERNAME: postgres
      SPRING_DATASOURCE_PASSWORD: postgres
    depends_on:
      db:
        condition: service_healthy

volumes:
  pgdata:
`;
}

function genDockerignore(): string {
  return `target/
.git/
.gitignore
*.iml
.idea/
.vscode/
`;
}

function genReadme(artifactId: string): string {
  const dbName = artifactId.replace(/-/g, '_');
  return `# ${artifactId}

Proyecto Spring Boot generado automáticamente desde el modelo de dominio.

## Opción A — Todo en Docker (recomendado)

Levanta la aplicación y PostgreSQL juntos; la base de datos \`${dbName}\`
se crea sola y las tablas se generan con \`ddl-auto: update\`:

\`\`\`bash
docker compose up --build
\`\`\`

API disponible en \`http://localhost:8080\`.

## Opción B — App local + Postgres en Docker

\`\`\`bash
docker run -d --name ${artifactId}-db \\
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \\
  -e POSTGRES_DB=${dbName} -p 5432:5432 postgres:16

mvn spring-boot:run
\`\`\`

## Opción C — Solo compilar

\`\`\`bash
mvn package -DskipTests
java -jar target/${artifactId}-1.0.0-SNAPSHOT.jar
\`\`\`

Requiere PostgreSQL accesible en \`localhost:5432\` (ver \`src/main/resources/application.yml\`).

## Documentación de la API

\`API.pdf\` lista todos los endpoints CRUD generados con ejemplos de body
para probarlos en Postman o curl.
`;
}

function genMainClass(groupId: string, appName: string): string {
  const pascal = toPascalCase(appName);
  return `package ${groupId};

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class ${pascal}Application {
    public static void main(String[] args) {
        SpringApplication.run(${pascal}Application.class, args);
    }
}
`;
}

// ─── Documentación PDF de la API ─────────────────────────────────────────────
// PDF 1.4 mínimo, determinista y sin dependencias: texto Helvetica/WinAnsi.

interface PdfLine {
  text: string;
  font: 'F1' | 'F2'; // F1 = Helvetica, F2 = Helvetica-Bold
  size: number;
}

/** Escapa paréntesis/backslash y degrada a WinAnsi (≈Latin-1) lo no soportado. */
function pdfText(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (ch === '(' || ch === ')' || ch === '\\') out += `\\${ch}`;
    else if (c < 0x80 || (c >= 0xa0 && c <= 0xff)) out += ch;
    else out += '?';
  }
  return out;
}

function renderPdfPage(lines: PdfLine[]): string {
  const parts = ['BT', '50 760 Td', '15 TL'];
  for (const l of lines) {
    parts.push(`/${l.font} ${l.size} Tf`, `(${pdfText(l.text)}) Tj`, 'T*');
  }
  parts.push('ET');
  return parts.join('\n');
}

function buildPdf(pages: PdfLine[][]): Uint8Array {
  const chunks: string[] = [];
  const offsets: number[] = [];
  let pos = 0;
  const push = (s: string) => { chunks.push(s); pos += s.length; };
  const obj = (id: number, body: string) => {
    offsets[id] = pos;
    push(`${id} 0 obj\n${body}\nendobj\n`);
  };

  const pageObjs = pages.map((_, i) => ({ pageId: 5 + i * 2, contentId: 6 + i * 2 }));

  push('%PDF-1.4\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${pageObjs.map((p) => `${p.pageId} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  obj(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  obj(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  pages.forEach((lines, i) => {
    const { pageId, contentId } = pageObjs[i];
    const stream = renderPdfPage(lines);
    obj(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`);
    obj(contentId, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });

  const xrefPos = pos;
  const size = 5 + pages.length * 2;
  push(`xref\n0 ${size}\n0000000000 65535 f \n`);
  for (let i = 1; i < size; i++) push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`);

  const text = chunks.join('');
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
  return bytes;
}

function sampleValue(javaType: string): string {
  switch (javaType) {
    case 'Integer':
    case 'Long':
      return '0';
    case 'Double':
      return '0.0';
    case 'Boolean':
      return 'true';
    case 'LocalDate':
      return '"2026-01-01"';
    case 'LocalDateTime':
      return '"2026-01-01T00:00:00"';
    case 'UUID':
      return '"00000000-0000-0000-0000-000000000000"';
    default:
      return '"texto"';
  }
}

/** Body JSON de ejemplo para el POST de una clase (attrs + relaciones por id). */
function exampleBodyLines(ctx: GeneratedClass): string[] {
  const parts: string[] = ctx.attributes.map((a) => `"${a.name}": ${sampleValue(a.javaType)}`);
  for (const a of ctx.associations) {
    parts.push(a.isCollection ? `"${a.name}": [{ "id": 1 }]` : `"${a.name}": { "id": 1 }`);
  }
  if (parts.length === 0) return ['{}'];
  return ['{', ...parts.map((p, i) => `  ${p}${i < parts.length - 1 ? ',' : ''}`), '}'];
}

/**
 * Genera API.pdf: documentación de todos los endpoints CRUD del proyecto con
 * ejemplos de body. Determinista (mismo modelo → mismo PDF, byte a byte).
 */
function genApiDocsPdf(appName: string, artifactId: string, ctxs: GeneratedClass[]): Uint8Array {
  const lines: PdfLine[] = [];
  const push = (text = '', font: PdfLine['font'] = 'F1', size = 9) => {
    // Envuelve líneas largas (~110 chars a 9pt caben en el ancho de página)
    while (text.length > 105) {
      const cut = text.lastIndexOf(' ', 105);
      const at = cut > 20 ? cut : 105;
      lines.push({ text: text.slice(0, at), font, size });
      text = '  ' + text.slice(at).trimStart();
    }
    lines.push({ text, font, size });
  };

  push(`${appName} — API REST`, 'F2', 16);
  push(`Proyecto generado automáticamente · artifactId: ${artifactId}`);
  push();
  push('Cómo ejecutar', 'F2', 12);
  push('  docker compose up --build   (levanta la app y PostgreSQL)');
  push('  API en http://localhost:8080 · BD en localhost:5432 (postgres/postgres)');
  push();
  push('Convenciones', 'F2', 12);
  push('  Todos los POST y PUT llevan header  Content-Type: application/json');
  push('  Fechas: "yyyy-MM-dd" · Fecha-hora: "yyyy-MM-ddTHH:mm:ss"');
  push('  Relaciones: objeto anidado {"id": N} enlaza una fila existente');
  push('  Colecciones: lista de objetos [{"id": 1}, {"id": 2}]');
  push();
  push('Endpoints', 'F2', 13);

  for (const ctx of ctxs) {
    const base = `/${toKebabCase(ctx.name)}s`;
    push();
    push(`${ctx.pascalName} — ${base}`, 'F2', 11);
    push(`  GET     ${base}          Lista todos los ${ctx.name}`);
    push(`  GET     ${base}/{id}     Obtiene uno por id`);
    push(`  POST    ${base}          Crea — body JSON:`);
    for (const l of exampleBodyLines(ctx)) push(`    ${l}`);
    push(`  PUT     ${base}/{id}     Actualiza — mismo body del POST (el id del path manda)`);
    push(`  DELETE  ${base}/{id}     Elimina por id`);
  }

  // Paginación: ~760pt de altura útil, alto de línea ≈ size * 1.6
  const pages: PdfLine[][] = [];
  let page: PdfLine[] = [];
  let y = 760;
  for (const l of lines) {
    const h = Math.max(10, l.size * 1.6);
    if (y - h < 60 && page.length > 0) {
      pages.push(page);
      page = [];
      y = 760;
    }
    page.push(l);
    y -= h;
  }
  if (page.length > 0) pages.push(page);
  return buildPdf(pages.length > 0 ? pages : [[]]);
}


export interface SpringBootGeneratorOptions {
  groupId?: string;
  artifactId?: string;
}

/**
 * Construye el ZIP del proyecto Spring Boot completo (sin descargarlo).
 * Separado de la descarga para permitir pruebas unitarias del contenido.
 */
export function buildSpringBootZip(
  model: CanonicalDomainModel,
  options: SpringBootGeneratorOptions = {}
): JSZip {
  // Invariante: nunca emitir un proyecto que no compila o rompe JPA.
  const diagnostics = validateSpringBootModel(model, options);
  if (diagnostics.some((d) => d.severity === 'ERROR')) {
    throw new SpringBootValidationError(diagnostics);
  }
  const groupId = options.groupId ?? `com.example.${javaId(model.name)}`;
  const artifactId = options.artifactId ?? toKebabCase(model.name);
  const appName = toPascalCase(model.name);
  const srcBase = `src/main/java/${groupId.replace(/\./g, '/')}`;

  const zip = new JSZip();

  // pom.xml
  zip.file('pom.xml', genPom(groupId, artifactId));

  // application.yml
  zip.file('src/main/resources/application.yml', genApplicationYml(artifactId));

  // Docker + instrucciones de ejecución
  zip.file('Dockerfile', genDockerfile());
  zip.file('docker-compose.yml', genDockerCompose(artifactId));
  zip.file('.dockerignore', genDockerignore());
  zip.file('README.md', genReadme(artifactId));

  // Clase principal
  zip.file(`${srcBase}/${appName}Application.java`, genMainClass(groupId, appName));

  const classCtxs = model.classes.map((cls) => buildClassContext(cls, model, groupId));

  // Documentación de endpoints (determinista: mismo modelo → mismo PDF)
  zip.file('API.pdf', genApiDocsPdf(appName, artifactId, classCtxs));

  // Capas por clase, todas bajo el paquete raíz
  for (const ctx of classCtxs) {
    zip.file(`${srcBase}/entity/${ctx.pascalName}Entity.java`, genEntity(ctx));
    zip.file(`${srcBase}/dto/${ctx.pascalName}DTO.java`, genDTO(ctx));
    zip.file(`${srcBase}/repository/${ctx.pascalName}Repository.java`, genRepository(ctx));
    zip.file(`${srcBase}/service/${ctx.pascalName}Service.java`, genService(ctx));
    zip.file(`${srcBase}/controller/${ctx.pascalName}Controller.java`, genController(ctx));
  }

  return zip;
}

/**
 * Genera un ZIP con el proyecto Spring Boot completo y lo descarga en el
 * browser. No requiere servidor ni CLI.
 */
export async function generateAndDownloadSpringBoot(
  model: CanonicalDomainModel,
  options: SpringBootGeneratorOptions = {}
): Promise<void> {
  const artifactId = options.artifactId ?? toKebabCase(model.name);
  const zip = buildSpringBootZip(model, options);

  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${artifactId}-spring-boot.zip`;
  a.click();
  URL.revokeObjectURL(url);
}
