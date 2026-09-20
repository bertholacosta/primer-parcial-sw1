import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { App, DEFAULT_CANONICAL_FIXTURE } from '../App';
import { UmlClassNode } from '../components/UmlClassNode';
import type { UmlClassFlowNode } from '../adapter/domainModelAdapter';

describe('CaseWeb Visual Rendering & Error State (P4-003)', () => {
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
});
