import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { AssistantChatPanel } from '../components/AssistantChatPanel';
import type { CanonicalDomainModel } from '../domain/model';

const MODEL: CanonicalDomainModel = {
  contractVersion: '1',
  id: 'model-1',
  name: 'Tienda',
  version: '1',
  classes: [
    {
      id: 'cls-cliente',
      name: 'Cliente',
      attributes: [
        { id: 'attr-email', name: 'email', type: 'String', nullable: false, multiplicity: '1' },
      ],
    },
  ],
  associations: [],
};

const openPanel = () => {
  fireEvent.click(screen.getByTestId('assistant-fab'));
};

const typeAndSend = (text: string) => {
  fireEvent.change(screen.getByTestId('assistant-input'), { target: { value: text } });
  fireEvent.click(screen.getByTestId('assistant-send'));
};

describe('AssistantChatPanel — fallback a IA remota', () => {
  it('usa el parser local cuando entiende la frase sin llamar a la IA', () => {
    const onInterpretRemote = vi.fn();
    const onApply = vi.fn();
    render(<AssistantChatPanel model={MODEL} onApply={onApply} onInterpretRemote={onInterpretRemote} />);
    openPanel();
    typeAndSend('crea clase Producto');
    expect(onInterpretRemote).not.toHaveBeenCalled();
    expect(screen.getByText(/Crear la clase 'Producto'/)).toBeTruthy();
  });

  it('consulta a la IA cuando el parser no entiende y muestra la propuesta', async () => {
    const onInterpretRemote = vi.fn().mockResolvedValue({
      summary: 'IA: Crear la clase Factura',
      commands: [{ type: 'CreateClass', payload: { id: 'cls-1', name: 'Factura' } }],
    });
    const onApply = vi.fn();
    render(<AssistantChatPanel model={MODEL} onApply={onApply} onInterpretRemote={onInterpretRemote} />);
    openPanel();
    typeAndSend('hazme una cosa rara que el parser no entienda');

    expect(screen.getByText('Consultando a la IA…')).toBeTruthy();
    await waitFor(() => expect(onInterpretRemote).toHaveBeenCalledWith('hazme una cosa rara que el parser no entienda'));
    await screen.findByText('IA: Crear la clase Factura');

    fireEvent.click(screen.getByTestId(/chat-apply-/));
    expect(onApply).toHaveBeenCalledWith([{ type: 'CreateClass', payload: { id: 'cls-1', name: 'Factura' } }]);
  });

  it('muestra la aclaración cuando la IA no produce comandos', async () => {
    const onInterpretRemote = vi.fn().mockResolvedValue({
      clarification: 'La IA propuso cambios pero no validan: CLASS_NOT_FOUND.',
    });
    render(<AssistantChatPanel model={MODEL} onApply={vi.fn()} onInterpretRemote={onInterpretRemote} />);
    openPanel();
    typeAndSend('instrucción incomprensible para el parser');
    await screen.findByText(/no validan/);
    expect(screen.queryByTestId(/chat-apply-/)).toBeNull();
  });

  it('sin onInterpretRemote usa solo la aclaración local', () => {
    render(<AssistantChatPanel model={MODEL} onApply={vi.fn()} />);
    openPanel();
    typeAndSend('instrucción incomprensible para el parser');
    expect(screen.getByText(/No entendí la instrucción/)).toBeTruthy();
  });
});
