import { describe, it, expect } from 'vitest';
import { parseDomainModel } from '../adapter/domainModelAdapter';
import { DEFAULT_CANONICAL_FIXTURE } from '../App';
import {
  buildSpringBootZip,
  validateSpringBootModel,
  SpringBootValidationError,
} from '../generator/springBootGenerator';
import type { CanonicalDomainModel } from '../domain/model';

describe('springBootGenerator — buildSpringBootZip', () => {
  const model = parseDomainModel(DEFAULT_CANONICAL_FIXTURE);
  const zip = buildSpringBootZip(model);
  const srcBase = 'src/main/java/com/example/biblioteca';

  it('genera pom.xml, application.yml y la clase principal', () => {
    expect(zip.file('pom.xml')).toBeTruthy();
    expect(zip.file('src/main/resources/application.yml')).toBeTruthy();
    expect(zip.file(`${srcBase}/BibliotecaApplication.java`)).toBeTruthy();
  });

  it('genera las cinco capas por cada clase del modelo bajo el paquete raíz', () => {
    for (const pascal of ['Libro', 'Autor']) {
      for (const layer of ['entity', 'dto', 'repository', 'service', 'controller']) {
        const suffix = { entity: 'Entity', dto: 'DTO', repository: 'Repository', service: 'Service', controller: 'Controller' }[layer];
        expect(zip.file(`${srcBase}/${layer}/${pascal}${suffix}.java`)).toBeTruthy();
      }
    }
  });

  it('la entidad contiene @Entity, tabla snake_case, id por defecto y tipos Java', async () => {
    const entity = await zip.file(`${srcBase}/entity/LibroEntity.java`)!.async('string');
    expect(entity).toContain('@Entity');
    expect(entity).toContain('@Table(name = "libro")');
    expect(entity).toContain('private Long id;');
    expect(entity).toContain('private String titulo;');
    expect(entity).toContain('private LocalDate fechaPublicacion;');
    expect(entity).toContain('@Column(name = "fecha_publicacion")');
  });

  it('mapea la asociación con multiplicidad * como colección ManyToMany', async () => {
    const entity = await zip.file(`${srcBase}/entity/LibroEntity.java`)!.async('string');
    expect(entity).toContain('@ManyToMany');
    expect(entity).toContain('List<AutorEntity> autorList');
  });

  it('los tipos relacionados viven en el paquete raíz: sin imports entre clases, sí entre capas', async () => {
    // Con un único paquete raíz, entidades relacionadas comparten paquete
    // (sin import), mientras el service importa las capas entity/dto.
    const entity = await zip.file(`${srcBase}/entity/LibroEntity.java`)!.async('string');
    expect(entity).toContain('package com.example.biblioteca.entity;');
    expect(entity).not.toContain('import com.example.biblioteca.entity.AutorEntity;');
    expect(entity).toContain('List<AutorEntity> autorList');

    const dto = await zip.file(`${srcBase}/dto/LibroDTO.java`)!.async('string');
    expect(dto).toContain('package com.example.biblioteca.dto;');
    expect(dto).toContain('List<AutorDTO> autorList');

    const service = await zip.file(`${srcBase}/service/LibroService.java`)!.async('string');
    expect(service).toContain('import com.example.biblioteca.dto.AutorDTO;');
    expect(service).toContain('import com.example.biblioteca.entity.AutorEntity;');
    // El shallow copy preserva el id para referenciar la fila existente.
    expect(service).toContain('dto.setId(entity.getId())');
    expect(service).toContain('entity.setId(dto.getId())');
  });

  it('el repositorio extiende JpaRepository con el tipo de id correcto', async () => {
    const repo = await zip.file(`${srcBase}/repository/LibroRepository.java`)!.async('string');
    expect(repo).toContain('extends JpaRepository<LibroEntity, Long>');
  });

  it('el controller expone el endpoint REST en plural', async () => {
    const ctrl = await zip.file(`${srcBase}/controller/LibroController.java`)!.async('string');
    expect(ctrl).toContain('@RestController');
    expect(ctrl).toContain('@RequestMapping("/libros")');
  });

  it('el CRUD incluye PUT /{id} que actualiza sobre la entidad existente', async () => {
    const ctrl = await zip.file(`${srcBase}/controller/LibroController.java`)!.async('string');
    expect(ctrl).toContain('@PutMapping("/{id}")');
    expect(ctrl).toContain('service.update(id, dto)');

    const service = await zip.file(`${srcBase}/service/LibroService.java`)!.async('string');
    expect(service).toContain('public Optional<LibroDTO> update(Long id, LibroDTO dto)');
    expect(service).toContain('repository.findById(id).map(existing ->');
    // La actualización copia atributos y relaciones sobre la entidad existente
    expect(service).toContain('existing.setTitulo(dto.getTitulo())');
    expect(service).toContain('existing.setAutorList(');
  });

  it('el pom incluye spring-boot-starter-data-jpa y web', async () => {
    const pom = await zip.file('pom.xml')!.async('string');
    expect(pom).toContain('spring-boot-starter-data-jpa');
    expect(pom).toContain('spring-boot-starter-web');
    expect(pom).toContain('<artifactId>biblioteca</artifactId>');
  });

  it('respeta groupId y artifactId personalizados', () => {
    const custom = buildSpringBootZip(model, { groupId: 'bo.edu.umsa', artifactId: 'mi-app' });
    expect(custom.file('src/main/java/bo/edu/umsa/BibliotecaApplication.java')).toBeTruthy();
    expect(custom.file('src/main/java/bo/edu/umsa/entity/LibroEntity.java')).toBeTruthy();
  });

  it('normaliza nombres con espacios y tildes a identificadores válidos', async () => {
    // Regresión: "Sistema de Inscripción" producía artifactId "sistema de -inscripcion"
    // (inválido para Maven) y paquetes/campos Java con espacios.
    const spaced = buildSpringBootZip({
      ...model,
      name: 'Sistema de Inscripción',
      classes: [
        {
          id: 'c1',
          name: 'Línea Asignación',

          attributes: [
            { id: 'a1', name: 'precio unit', type: 'Double', multiplicity: '1', nullable: false },
          ],
        },
      ],
      associations: [],
    });
    const pom = await spaced.file('pom.xml')!.async('string');
    expect(pom).toContain('<artifactId>sistema-de-inscripcion</artifactId>');
    expect(pom).toContain('<groupId>com.example.sistemaDeInscripcion</groupId>');

    const entity = await spaced
      .file('src/main/java/com/example/sistemaDeInscripcion/entity/LineaAsignacionEntity.java')!
      .async('string');
    expect(entity).toContain('@Table(name = "linea_asignacion")');
    expect(entity).toContain('private Double precioUnit;');
    expect(entity).toContain('@Column(name = "precio_unit"');
    expect(entity).toContain('getPrecioUnit()');
  });

  it('incluye Dockerfile, docker-compose.yml, .dockerignore y README', async () => {
    const dockerfile = await zip.file('Dockerfile')!.async('string');
    expect(dockerfile).toContain('eclipse-temurin-17');
    expect(dockerfile).toContain('EXPOSE 8080');

    const compose = await zip.file('docker-compose.yml')!.async('string');
    // La BD se llama como el artifactId con guiones → guiones bajos
    expect(compose).toContain('POSTGRES_DB: biblioteca');
    // La app conecta al servicio "db" via variables de entorno de Spring
    expect(compose).toContain('SPRING_DATASOURCE_URL: jdbc:postgresql://db:5432/biblioteca');
    expect(compose).toContain('condition: service_healthy');

    expect(zip.file('.dockerignore')).toBeTruthy();
    const readme = await zip.file('README.md')!.async('string');
    expect(readme).toContain('docker compose up');
  });

  it('incluye API.pdf válido con todos los endpoints documentados', async () => {
    const pdf = await zip.file('API.pdf')!.async('uint8array');
    const text = new TextDecoder('latin1').decode(pdf);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('%%EOF');
    expect(text).toContain('xref');
    expect(text).toContain('trailer');
    // Endpoints de cada clase del fixture (pluralización simple: nombre + "s")
    expect(text).toContain('/libros');
    expect(text).toContain('/autors');
    expect(text).toContain('GET');
    expect(text).toContain('POST');
    expect(text).toContain('PUT');
    expect(text).toContain('DELETE');
    // Ejemplo de body con los atributos de la clase
    expect(text).toContain('"titulo"');
  });
});

describe('springBootGenerator — validación previa a la exportación', () => {
  const base: Omit<CanonicalDomainModel, 'classes' | 'associations'> = {
    id: 'm1', name: 'Demo', version: '1.0.0', contractVersion: '1',
  } as Omit<CanonicalDomainModel, 'classes' | 'associations'>;
  const cls = (id: string, name: string, attributes: CanonicalDomainModel['classes'][number]['attributes'] = []) =>
    ({ id, name, attributes }) as CanonicalDomainModel['classes'][number];
  const attr = (id: string, name: string, type = 'String', description?: string) =>
    ({ id, name, type, multiplicity: '1', nullable: false, description });
  const assoc = (id: string, source: string, target: string, extra: Record<string, unknown> = {}) =>
    ({ id, sourceClassId: source, targetClassId: target, kind: 'association',
       sourceMultiplicity: '1', targetMultiplicity: '1', navigability: 'unidirectional', ...extra
    }) as CanonicalDomainModel['associations'][number];

  const codes = (m: CanonicalDomainModel) => validateSpringBootModel(m).map((d) => d.code);

  it('rechaza atributo "id" sin [PK] cuando se genera un id autogenerado', () => {
    const m = { ...base, classes: [cls('c1', 'Venta', [attr('a1', 'id')])], associations: [] };
    expect(codes(m)).toContain('ID_FIELD_COLLISION');
    expect(() => buildSpringBootZip(m)).toThrow(SpringBootValidationError);
  });

  it('rechaza más de un [PK] por clase', () => {
    const m = { ...base, classes: [cls('c1', 'Venta', [attr('a1', 'idA', 'Long', '[PK]'), attr('a2', 'idB', 'Long', '[PK]')])], associations: [] };
    expect(codes(m)).toContain('MULTIPLE_PK');
  });

  it('rechaza [PK] de tipo no autogenerable', () => {
    const m = { ...base, classes: [cls('c1', 'Venta', [attr('a1', 'codigo', 'String', '[PK]')])], associations: [] };
    expect(codes(m)).toContain('INVALID_PK_TYPE');
  });

  it('rechaza clases que normalizan al mismo tipo Java', () => {
    const m = { ...base, classes: [cls('c1', 'Línea Asignación'), cls('c2', 'linea asignacion')], associations: [] };
    expect(codes(m)).toContain('DUPLICATE_CLASS_NAME');
  });

  it('rechaza atributos que normalizan al mismo campo', () => {
    const m = { ...base, classes: [cls('c1', 'Venta', [attr('a1', 'precio unit'), attr('a2', 'precioUnit')])], associations: [] };
    expect(codes(m)).toContain('DUPLICATE_FIELD');
  });

  it('rechaza identificadores reservados de Java', () => {
    const m = { ...base, classes: [cls('c1', 'Venta', [attr('a1', 'class')])], associations: [] };
    expect(codes(m)).toContain('RESERVED_IDENTIFIER');
  });

  it('rechaza relaciones a clases inexistentes y clase-asociación sin portadora', () => {
    const dangling = { ...base, classes: [cls('c1', 'Venta')], associations: [assoc('x1', 'c1', 'ghost')] };
    expect(codes(dangling)).toContain('DANGLING_ASSOCIATION');

    const noCarrier = {
      ...base,
      classes: [cls('c1', 'Venta'), cls('c2', 'Producto')],
      associations: [assoc('x2', 'c1', 'c2', { kind: 'associationClass' })],
    };
    expect(codes(noCarrier)).toContain('MISSING_ASSOC_CLASS');
  });

  it('rechaza atributo que duplica la columna FK de una relación', () => {
    const m = {
      ...base,
      classes: [cls('c1', 'Venta', [attr('a1', 'vendedor id')]), cls('c2', 'Vendedor')],
      associations: [assoc('x1', 'c1', 'c2', { sourceMultiplicity: '0..*' })],
    };
    expect(codes(m)).toContain('FK_COLUMN_COLLISION');
  });

  it('rechaza dos relaciones al mismo destino que generan el mismo campo', () => {
    const m = {
      ...base,
      classes: [cls('c1', 'Cliente'), cls('c2', 'Venta')],
      associations: [assoc('x1', 'c1', 'c2', { targetMultiplicity: '0..*' }), assoc('x2', 'c1', 'c2', { targetMultiplicity: '0..*' })],
    };
    expect(codes(m)).toContain('DUPLICATE_FIELD');
  });

  it('advierte sobre [FK] en atributos pero permite la exportación', () => {
    const m = { ...base, classes: [cls('c1', 'Venta', [attr('a1', 'vendedorRef', 'Long', '[FK]')])], associations: [] };
    const diags = validateSpringBootModel(m);
    expect(diags.some((d) => d.code === 'FK_MARKER_IGNORED' && d.severity === 'WARNING')).toBe(true);
    expect(() => buildSpringBootZip(m)).not.toThrow();
  });

  it('el fixture canónico pasa la validación sin errores', () => {
    const canonical = parseDomainModel(DEFAULT_CANONICAL_FIXTURE);
    const diags = validateSpringBootModel(canonical);
    expect(diags.filter((d) => d.severity === 'ERROR')).toHaveLength(0);
  });
});
