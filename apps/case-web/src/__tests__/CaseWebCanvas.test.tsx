import { render, screen, fireEvent } from '@testing-library/react';
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
        isAbstract: false,
        attributes: [
          { id: 'a1', name: 'titulo', type: 'String', nullable: false, multiplicity: '1' },
          { id: 'a2', name: 'paginas', type: 'Integer', nullable: true, multiplicity: '0..1' },
        ],
      },
    };

    render(<UmlClassNode {...(mockNode as any)} />);

    // Figura ARIA
    const figure = screen.getByRole('figure');
    expect(figure).toHaveAttribute('aria-label', 'Clase UML Libro');

    // Nombre de la clase
    expect(screen.getByTestId('class-name-Libro')).toHaveTextContent('Libro');

    // Fila de atributos
    expect(screen.getByTestId('attribute-row-Libro-titulo')).toHaveTextContent('+ titulo: String');
    expect(screen.getByTestId('attribute-row-Libro-paginas')).toHaveTextContent('+ paginas: Integer');
  });

  it('renderiza la etiqueta «abstract» cuando la clase es abstracta', () => {
    const abstractNode: UmlClassFlowNode = {
      id: 'cls-abs',
      type: 'umlClass',
      position: { x: 0, y: 0 },
      data: {
        id: 'cls-abs',
        name: 'Publicacion',
        isAbstract: true,
        attributes: [],
      },
    };

    render(<UmlClassNode {...(abstractNode as any)} />);

    expect(screen.getByTestId('abstract-tag')).toHaveTextContent('«abstract»');
    expect(screen.getByText('(sin atributos)')).toBeInTheDocument();
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
