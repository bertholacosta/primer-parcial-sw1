import { describe, it, expect } from 'vitest';
import { parseDomainModel } from '../adapter/domainModelAdapter';
import { DEFAULT_CANONICAL_FIXTURE } from '../App';
import { buildSpringBootZip } from '../generator/springBootGenerator';

describe('springBootGenerator — buildSpringBootZip', () => {
  const model = parseDomainModel(DEFAULT_CANONICAL_FIXTURE);
  const zip = buildSpringBootZip(model);
  const srcBase = 'src/main/java/com/example/biblioteca';

  it('genera pom.xml, application.yml y la clase principal', () => {
    expect(zip.file('pom.xml')).toBeTruthy();
    expect(zip.file('src/main/resources/application.yml')).toBeTruthy();
    expect(zip.file(`${srcBase}/BibliotecaApplication.java`)).toBeTruthy();
  });

  it('genera las cinco capas por cada clase del modelo', () => {
    for (const cls of ['libro', 'autor']) {
      const pascal = cls === 'libro' ? 'Libro' : 'Autor';
      for (const layer of ['entity', 'dto', 'repository', 'service', 'controller']) {
        const suffix = { entity: 'Entity', dto: 'DTO', repository: 'Repository', service: 'Service', controller: 'Controller' }[layer];
        expect(zip.file(`${srcBase}/${cls}/${layer}/${pascal}${suffix}.java`)).toBeTruthy();
      }
    }
  });

  it('la entidad contiene @Entity, tabla snake_case, id por defecto y tipos Java', async () => {
    const entity = await zip.file(`${srcBase}/libro/entity/LibroEntity.java`)!.async('string');
    expect(entity).toContain('@Entity');
    expect(entity).toContain('@Table(name = "libro")');
    expect(entity).toContain('private Long id;');
    expect(entity).toContain('private String titulo;');
    expect(entity).toContain('private LocalDate fechaPublicacion;');
    expect(entity).toContain('@Column(name = "fecha_publicacion")');
  });

  it('mapea la asociación con multiplicidad * como colección ManyToMany', async () => {
    const entity = await zip.file(`${srcBase}/libro/entity/LibroEntity.java`)!.async('string');
    expect(entity).toContain('@ManyToMany');
    expect(entity).toContain('List<AutorEntity> autorList');
  });

  it('el repositorio extiende JpaRepository con el tipo de id correcto', async () => {
    const repo = await zip.file(`${srcBase}/libro/repository/LibroRepository.java`)!.async('string');
    expect(repo).toContain('extends JpaRepository<LibroEntity, Long>');
  });

  it('el controller expone el endpoint REST en plural', async () => {
    const ctrl = await zip.file(`${srcBase}/libro/controller/LibroController.java`)!.async('string');
    expect(ctrl).toContain('@RestController');
    expect(ctrl).toContain('@RequestMapping("/libros")');
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
    expect(custom.file('src/main/java/bo/edu/umsa/libro/entity/LibroEntity.java')).toBeTruthy();
  });
});
