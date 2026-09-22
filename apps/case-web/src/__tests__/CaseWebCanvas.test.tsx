import { render, screen, fireEvent } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { describe, it, expect } from 'vitest';
import { App, DEFAULT_CANONICAL_FIXTURE } from '../App';
import { UmlClassNode } from '../components/UmlClassNode';
import type { UmlClassFlowNode } from '../adapter/domainModelAdapter';

describe('CaseWeb Visual Rendering & Attribute Commands (P4-003 & P4-004)', () => {
  it('renderiza clases y atributos del fixture canónico en el canvas y en la lista accesible', () => {
    render(<App initialModelData={DEFAULT_CANONICAL_FIXTURE} />);

    // 1. Cabecera del modelo
    expect(screen.getByText(/Editor CASE — Biblioteca/i)).toBeInTheDocument();
    expect(screen.getByText(/2 clases renderizadas/i)).toBeInTheDocument();

    // 2. Lista semántica alternativa para accesibilidad (WCAG 2.1 AA)
    expect(screen.getByTestId('semantic-class-list')).toBeInTheDocument();
    expect(screen.getByTestId('semantic-item-Libro')).toBeInTheDocument();
    expect(screen.getByTestId('semantic-item-Autor')).toBeInTheDocument();

    // 3. Atributos dentro de la lista semántica
    const libroText = screen.getByTestId('semantic-item-Libro').textContent;
    expect(libroText).toContain('titulo: String [1]');
    expect(libroText).toContain('isbn: String [1]');
    expect(libroText).toContain('fechaPublicacion: Date [0..1]');

    const autorText = screen.getByTestId('semantic-item-Autor').textContent;
    expect(autorText).toContain('nombre: String [1]');
  });

  it('muestra un error explícito cuando se pasa un fixture con versión de contrato no soportada', () => {
    const invalidContractVersionFixture = {
      contractVersion: '2',
      id: 'm-1',
      name: 'Modelo Incompatible',
      version: '1.0.0',
      packages: [],
      classes: [],
      associations: [],
    };

    render(<App initialModelData={invalidContractVersionFixture} />);

    // Verifica que se muestra el alert de error y el mensaje explicativo
    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();

    const errorMessage = screen.getByTestId('error-message');
    expect(errorMessage.textContent).toContain('Unsupported contractVersion "2"');
    expect(errorMessage.textContent).toContain('Expected "1"');

    // No debe renderizarse el canvas
    expect(screen.queryByTestId('case-web-canvas-container')).not.toBeInTheDocument();
  });

  it('renderiza el nodo individual de clase UML con atributos y etiquetas ARIA de figura', () => {
    const mockNode: UmlClassFlowNode = {
      id: 'cls-01',
      type: 'umlClass',
      position: { x: 0, y: 0 },
      data: {
        id: 'cls-01',
        name: 'Libro',
        attributes: [
          { id: 'a1', name: 'titulo', type: 'String', nullable: false, multiplicity: '1' },
          { id: 'a2', name: 'paginas', type: 'Integer', nullable: true, multiplicity: '0..1' },
        ],
      },
    };

    render(
      <ReactFlowProvider>
        <UmlClassNode {...(mockNode as any)} />
      </ReactFlowProvider>
    );

    // Figura ARIA
    const figure = screen.getByRole('figure');
    expect(figure).toHaveAttribute('aria-label', 'Clase UML Libro');

    // Nombre de la clase
    expect(screen.getByTestId('class-name-Libro')).toHaveTextContent('Libro');

    // Fila de atributos
    expect(screen.getByTestId('attribute-row-Libro-titulo')).toHaveTextContent('+ titulo: String');
    expect(screen.getByTestId('attribute-row-Libro-paginas')).toHaveTextContent('+ paginas: Integer');
  });

  it('permite agregar un atributo dinámicamente mediante el botón + Atributo y actualiza el modelo y la vista (P4-004)', () => {
    render(<App initialModelData={DEFAULT_CANONICAL_FIXTURE} />);

    // Click en + Atributo de Libro
    const addBtn = screen.getByTestId('btn-add-attribute-Libro');
    fireEvent.click(addBtn);

    // Escribir nombre del nuevo atributo
    const nameInput = screen.getByTestId('add-attribute-name-input-Libro');
    fireEvent.change(nameInput, { target: { value: 'genero' } });

    // Click en Crear
    const confirmBtn = screen.getByTestId('confirm-add-attribute-Libro');
    fireEvent.click(confirmBtn);

    // Debe mostrarse en el nodo y en la lista semántica
    expect(screen.getByTestId('attribute-row-Libro-genero')).toBeInTheDocument();
    expect(screen.getByTestId('semantic-item-Libro').textContent).toContain('genero: String [1]');

    // El banner de comandos muestra accepted
    const banner = screen.getByTestId('command-result-banner');
    expect(banner.textContent).toContain('Comando aplicado');
    expect(banner.textContent).toContain('Versión del modelo: 1.0.1');
  });

  it('permite renombrar un atributo mediante edición inline y actualiza el modelo y la vista (P4-004)', () => {
    render(<App initialModelData={DEFAULT_CANONICAL_FIXTURE} />);

    // Click en editar isbn en Libro
    const editBtn = screen.getByTestId('btn-edit-attr-Libro-isbn');
    fireEvent.click(editBtn);

    // Cambiar nombre a codigoIsbn
    const editInput = screen.getByTestId('edit-attribute-input-attr-02');
    fireEvent.change(editInput, { target: { value: 'codigoIsbn' } });

    // Guardar
    const saveBtn = screen.getByTestId('confirm-edit-attribute-attr-02');
    fireEvent.click(saveBtn);

    // Debe actualizarse la vista
    expect(screen.getByTestId('attribute-row-Libro-codigoIsbn')).toBeInTheDocument();
    expect(screen.getByTestId('semantic-item-Libro').textContent).toContain('codigoIsbn: String [1]');

    const banner = screen.getByTestId('command-result-banner');
    expect(banner.textContent).toContain('Comando aplicado');
  });

  it('preserva el estado anterior si se intenta agregar un atributo con nombre inválido (P4-004)', () => {
    render(<App initialModelData={DEFAULT_CANONICAL_FIXTURE} />);

    const addBtn = screen.getByTestId('btn-add-attribute-Libro');
    fireEvent.click(addBtn);

    const nameInput = screen.getByTestId('add-attribute-name-input-Libro');
    fireEvent.change(nameInput, { target: { value: '123Invalido!' } });

    const confirmBtn = screen.getByTestId('confirm-add-attribute-Libro');
    fireEvent.click(confirmBtn);

    // Debe mostrarse el rechazo en el banner
    const banner = screen.getByTestId('command-result-banner');
    expect(banner.textContent).toContain('Comando rechazado');
    expect(banner.textContent).toContain('INVALID_NAME_FORMAT');

    // No se agregó el atributo inválido
    expect(screen.queryByTestId('attribute-row-Libro-123Invalido!')).not.toBeInTheDocument();
    expect(screen.getByTestId('semantic-item-Libro').textContent).not.toContain('123Invalido!');
  });
});

describe('CaseWeb Visual Association Commands (P4-005)', () => {
  it('renderiza la asociación del fixture en la lista accesible con identidad y multiplicidades', () => {
    render(<App initialModelData={DEFAULT_CANONICAL_FIXTURE} />);

    const assocList = screen.getByTestId('semantic-association-list');
    expect(assocList).toBeInTheDocument();

    const assocItem = screen.getByTestId('semantic-assoc-assoc-01');
    expect(assocItem.textContent).toContain('escritoPor');
    expect(assocItem.textContent).toContain('Libro');
    expect(assocItem.textContent).toContain('Autor');
    expect(assocItem.textContent).toContain('[0..*]');
    expect(assocItem.textContent).toContain('[1..*]');
    expect(assocItem.textContent).toContain('bidirectional');
  });

  it('crea una asociación válida desde la barra de herramientas y actualiza modelo y vista', () => {
    render(<App initialModelData={DEFAULT_CANONICAL_FIXTURE} />);

    fireEvent.click(screen.getByTestId('btn-add-association'));

    fireEvent.change(screen.getByTestId('assoc-name-input'), {
      target: { value: 'escribe' },
    });
    // Origen: Autor (cls-02), Destino: Libro (cls-01)
    fireEvent.change(screen.getByTestId('assoc-source-select'), {
      target: { value: 'cls-02' },
    });
    fireEvent.change(screen.getByTestId('assoc-source-mult-select'), {
      target: { value: '1..*' },
    });
    fireEvent.change(screen.getByTestId('assoc-target-select'), {
      target: { value: 'cls-01' },
    });
    fireEvent.change(screen.getByTestId('assoc-target-mult-select'), {
      target: { value: '0..*' },
    });
    fireEvent.change(screen.getByTestId('assoc-navigability-select'), {
      target: { value: 'bidirectional' },
    });

    fireEvent.click(screen.getByTestId('confirm-add-association'));

    // Banner de aceptación con la nueva versión del modelo
    const banner = screen.getByTestId('command-result-banner');
    expect(banner.textContent).toContain('Comando aplicado');
    expect(banner.textContent).toContain('Versión del modelo: 1.0.1');

    // La vista accesible refleja la nueva asociación con sus extremos y multiplicidades
    const assocList = screen.getByTestId('semantic-association-list');
    expect(assocList.textContent).toContain('escribe');
    expect(assocList.textContent).toContain('Autor [1..*] → Libro [0..*] (bidirectional)');
  });

  it('rechaza la creación cuando origen y destino son la misma clase y no muta el estado', () => {
    render(<App initialModelData={DEFAULT_CANONICAL_FIXTURE} />);

    fireEvent.click(screen.getByTestId('btn-add-association'));

    // Origen y destino = Libro (auto-asociación no permitida en v1)
    fireEvent.change(screen.getByTestId('assoc-source-select'), {
      target: { value: 'cls-01' },
    });
    fireEvent.change(screen.getByTestId('assoc-target-select'), {
      target: { value: 'cls-01' },
    });

    fireEvent.click(screen.getByTestId('confirm-add-association'));

    const banner = screen.getByTestId('command-result-banner');
    expect(banner.textContent).toContain('Comando rechazado');
    expect(banner.textContent).toContain('SELF_ASSOCIATION_NOT_ALLOWED');

    // Solo sigue existiendo la asociación del fixture
    const assocList = screen.getByTestId('semantic-association-list');
    expect(assocList.querySelectorAll('li')).toHaveLength(1);
  });
});

describe('CaseWeb Palette & CreateClass Command', () => {
  it('crea una clase desde la paleta y la refleja en la vista', () => {
    render(<App initialModelData={DEFAULT_CANONICAL_FIXTURE} />);

    fireEvent.click(screen.getByTestId('palette-item-class'));

    const banner = screen.getByTestId('command-result-banner');
    expect(banner.textContent).toContain('Comando aplicado');
    expect(banner.textContent).toContain('Versión del modelo: 1.0.1');

    expect(screen.getByText(/3 clases renderizadas/i)).toBeInTheDocument();
  });

  it('renombra una clase con doble clic sobre el nombre', () => {
    render(<App initialModelData={DEFAULT_CANONICAL_FIXTURE} />);

    fireEvent.doubleClick(screen.getByTestId('class-name-Libro'));
    const input = screen.getByTestId('rename-class-input-cls-01');
    fireEvent.change(input, { target: { value: 'Ejemplar' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    const banner = screen.getByTestId('command-result-banner');
    expect(banner.textContent).toContain('Comando aplicado');
    expect(screen.getByTestId('semantic-item-Ejemplar')).toBeInTheDocument();
  });

  it('rechaza un renombrado a nombre duplicado en el mismo ámbito sin mutar el modelo', () => {
    render(<App initialModelData={DEFAULT_CANONICAL_FIXTURE} />);

    fireEvent.doubleClick(screen.getByTestId('class-name-Libro'));
    const input = screen.getByTestId('rename-class-input-cls-01');
    fireEvent.change(input, { target: { value: 'Autor' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    const banner = screen.getByTestId('command-result-banner');
    expect(banner.textContent).toContain('Comando rechazado');
    expect(banner.textContent).toContain('DUPLICATE_CLASS_NAME');

    expect(screen.getByTestId('semantic-item-Libro')).toBeInTheDocument();
    expect(screen.getByTestId('semantic-item-Autor')).toBeInTheDocument();
  });
});

describe('Tipos de relación UML en el popover (ADR-0009)', () => {
  it('generalización oculta multiplicidades/navegabilidad y crea la relación', () => {
    render(<App initialModelData={DEFAULT_CANONICAL_FIXTURE} />);

    fireEvent.click(screen.getByTestId('btn-add-association'));
    fireEvent.change(screen.getByTestId('assoc-kind-select'), { target: { value: 'generalization' } });

    // Sin campos de multiplicidad ni navegabilidad
    expect(screen.queryByTestId('assoc-source-mult-select')).not.toBeInTheDocument();
    expect(screen.queryByTestId('assoc-navigability-select')).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId('assoc-source-select'), { target: { value: 'cls-01' } });
    fireEvent.change(screen.getByTestId('assoc-target-select'), { target: { value: 'cls-02' } });
    fireEvent.click(screen.getByTestId('confirm-add-association'));

    const banner = screen.getByTestId('command-result-banner');
    expect(banner.textContent).toContain('Comando aplicado');
    expect(screen.getByTestId('semantic-association-list').textContent).toContain('«generalization»');
  });

  it('clase-asociación exige la clase portadora y la crea al elegirla', () => {
    render(<App initialModelData={DEFAULT_CANONICAL_FIXTURE} />);

    fireEvent.click(screen.getByTestId('btn-add-association'));
    fireEvent.change(screen.getByTestId('assoc-kind-select'), { target: { value: 'associationClass' } });
    fireEvent.change(screen.getByTestId('assoc-source-select'), { target: { value: 'cls-01' } });
    fireEvent.change(screen.getByTestId('assoc-target-select'), { target: { value: 'cls-02' } });

    // Sin clase portadora → rechazado
    fireEvent.click(screen.getByTestId('confirm-add-association'));
    expect(screen.getByTestId('command-result-banner').textContent).toContain('MISSING_ASSOCIATION_CLASS');

    // Eligiendo la clase portadora → aceptado
    fireEvent.click(screen.getByTestId('btn-add-association'));
    fireEvent.change(screen.getByTestId('assoc-kind-select'), { target: { value: 'associationClass' } });
    fireEvent.change(screen.getByTestId('assoc-source-select'), { target: { value: 'cls-01' } });
    fireEvent.change(screen.getByTestId('assoc-target-select'), { target: { value: 'cls-02' } });
    fireEvent.change(screen.getByTestId('assoc-class-select'), { target: { value: 'cls-02' } });
    fireEvent.click(screen.getByTestId('confirm-add-association'));
    expect(screen.getByTestId('command-result-banner').textContent).toContain('Comando aplicado');
    expect(screen.getByTestId('semantic-association-list').textContent).toContain('«associationClass»');
  });

  it('composición rechaza una parte ya ocupada por otra composición', () => {
    render(<App initialModelData={DEFAULT_CANONICAL_FIXTURE} />);

    // Todo=cls-01 → Parte=cls-02
    fireEvent.click(screen.getByTestId('btn-add-association'));
    fireEvent.change(screen.getByTestId('assoc-kind-select'), { target: { value: 'composition' } });
    fireEvent.change(screen.getByTestId('assoc-source-select'), { target: { value: 'cls-01' } });
    fireEvent.change(screen.getByTestId('assoc-target-select'), { target: { value: 'cls-02' } });
    fireEvent.click(screen.getByTestId('confirm-add-association'));
    expect(screen.getByTestId('command-result-banner').textContent).toContain('Comando aplicado');

    // Otro todo sobre la misma parte → rechazado
    fireEvent.click(screen.getByTestId('btn-add-association'));
    fireEvent.change(screen.getByTestId('assoc-kind-select'), { target: { value: 'composition' } });
    fireEvent.change(screen.getByTestId('assoc-source-select'), { target: { value: 'cls-02' } });
    fireEvent.change(screen.getByTestId('assoc-target-select'), { target: { value: 'cls-02' } });
    fireEvent.click(screen.getByTestId('confirm-add-association'));
    const banner = screen.getByTestId('command-result-banner');
    expect(banner.textContent).toContain('Comando rechazado');
  });
});
