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

function toPascalCase(s: string): string {
  return s.replace(/(?:^|[-_\s])(\w)/g, (_, c) => c.toUpperCase());
}

function toSnakeCase(s: string): string {
  return s.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
}

function toKebabCase(s: string): string {
  return toSnakeCase(s).replace(/_/g, '-');
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
  joinColumn: string;
  joinTable: string;
  inverseJoinColumn: string;
  isCollection: boolean;
  inverse: boolean;
}

interface RelatedType {
  className: string;
  accessors: string[];
}

// ─── Contexto de clase ───────────────────────────────────────────────────────

function buildClassContext(
  cls: CanonicalClass,
  model: CanonicalDomainModel,
  groupId: string
): GeneratedClass {
  const pascalName = toPascalCase(cls.name);
  const packagePath = `${groupId}.${cls.name.toLowerCase()}`;

  // Atributos
  const attrCtxList: AttrCtx[] = cls.attributes.map((attr) => {
    const meta = parseAttrMeta(attr.description);
    const javaType = toJavaType(attr.type);
    return {
      name: attr.name,
      capitalizedName: capitalize(attr.name),
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
  const incoming = model.associations.filter(
    (a) => a.targetClassId === cls.id && a.kind !== 'generalization'
  );

  const assocCtxList: AssocCtx[] = [];
  const relatedTypeMap = new Map<string, RelatedType>();

  for (const assoc of outgoing) {
    const targetClass = model.classes.find((c) => c.id === assoc.targetClassId);
    if (!targetClass) continue;

    const targetPascal = toPascalCase(targetClass.name);
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
      if (kind === 'composition' || kind === 'aggregation') {
        const targetHasMany = model.associations.some(
          (a) => a.targetClassId === cls.id && a.sourceClassId === assoc.targetClassId
        );
        if (targetHasMany) {
          annotationFull = `@ManyToMany`;
          joinTable = `${toSnakeCase(cls.name)}_${toSnakeCase(targetClass.name)}`;
        } else {
          annotationFull = `@OneToMany(mappedBy = "${cls.name.toLowerCase()}", cascade = CascadeType.ALL)`;
        }
      } else {
        // association many
        const reverseMany = incoming.some((a) => a.sourceClassId === assoc.targetClassId && a.targetMultiplicity.includes('*'));
        if (reverseMany) {
          annotationFull = `@ManyToMany`;
          joinTable = `${toSnakeCase(cls.name)}_${toSnakeCase(targetClass.name)}`;
        } else {
          annotationFull = `@ManyToMany`;
          joinTable = `${toSnakeCase(cls.name)}_${toSnakeCase(targetClass.name)}`;
        }
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
      ? targetClass.name.toLowerCase() + 'List'
      : targetClass.name.toLowerCase();

    assocCtxList.push({
      name: fieldName,
      capitalizedName: capitalize(fieldName),
      annotationFull,
      javaType,
      baseJavaType: targetPascal,
      joinColumn,
      joinTable,
      inverseJoinColumn,
      isCollection,
      inverse: !isOwner,
    });

    // Agregar tipo relacionado para shallow copy en Service
    if (!relatedTypeMap.has(targetPascal)) {
      const targetAttrs = targetClass.attributes.map((a) => capitalize(a.name));
      relatedTypeMap.set(targetPascal, { className: targetPascal, accessors: targetAttrs });
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

  return `package ${ctx.packagePath}.service;

import ${ctx.packagePath}.dto.${ctx.pascalName}DTO;
import ${ctx.packagePath}.entity.${ctx.pascalName}Entity;
import ${ctx.packagePath}.repository.${ctx.pascalName}Repository;
import org.springframework.stereotype.Service;
import java.util.List;
import java.util.Optional;
import java.util.stream.Collectors;
${idImport}
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
  const restPath = `/${ctx.name.toLowerCase()}s`;
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

// ─── Punto de entrada ────────────────────────────────────────────────────────

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
  const groupId = options.groupId ?? `com.example.${model.name.toLowerCase().replace(/\s+/g, '')}`;
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

  // Capas por clase
  for (const cls of model.classes) {
    const ctx = buildClassContext(cls, model, groupId);
    const base = `${srcBase}/${cls.name.toLowerCase()}`;

    zip.file(`${base}/entity/${ctx.pascalName}Entity.java`, genEntity(ctx));
    zip.file(`${base}/dto/${ctx.pascalName}DTO.java`, genDTO(ctx));
    zip.file(`${base}/repository/${ctx.pascalName}Repository.java`, genRepository(ctx));
    zip.file(`${base}/service/${ctx.pascalName}Service.java`, genService(ctx));
    zip.file(`${base}/controller/${ctx.pascalName}Controller.java`, genController(ctx));
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
