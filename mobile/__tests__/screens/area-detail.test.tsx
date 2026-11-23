import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, userEvent } from '@testing-library/react-native';
import EditAreaScreen from '@/app/(manager)/areas/[id]';

const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, push: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => ({ id: 'area-1' }),
}));

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
}));

const mockGetArea = jest.fn();
const mockListProducts = jest.fn();
const mockUpdateArea = jest.fn();
const mockDeleteArea = jest.fn();
jest.mock('../../src/services/api', () => ({
  api: {
    getArea: (...args: unknown[]) => mockGetArea(...args),
    listProducts: (...args: unknown[]) => mockListProducts(...args),
    updateArea: (...args: unknown[]) => mockUpdateArea(...args),
    deleteArea: (...args: unknown[]) => mockDeleteArea(...args),
  },
}));

const mockConfirmAction = jest.fn();
const mockShowMessage = jest.fn();
jest.mock('../../src/utils/confirm', () => ({
  confirmAction: (...args: unknown[]) => mockConfirmAction(...args),
  showMessage: (...args: unknown[]) => mockShowMessage(...args),
}));

function renderWithQuery() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <EditAreaScreen />
    </QueryClientProvider>,
  );
}

describe('EditAreaScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetArea.mockResolvedValue({
      id: 'area-1',
      name: 'Gôndola 1',
      description: 'Corredor central',
      product_ids: ['p1'],
    });
    mockListProducts.mockResolvedValue([
      { id: 'p1', name: 'Café Torrado', variant: '500g' },
      { id: 'p2', name: 'Açúcar Refinado', variant: '1kg' },
    ]);
  });

  test('carrega dados da área, permite editar nome/itens e salva via updateArea', async () => {
    mockUpdateArea.mockResolvedValueOnce({ id: 'area-1' });
    const user = userEvent.setup();
    await renderWithQuery();

    const nameInput = await screen.findByDisplayValue('Gôndola 1');
    expect(screen.getByDisplayValue('Corredor central')).toBeOnTheScreen();

    await user.clear(nameInput);
    await user.type(nameInput, 'Gôndola 1 - Cafés');
    await user.press(screen.getByText('Açúcar Refinado'));
    await user.press(screen.getByRole('button', { name: 'Salvar Alterações' }));

    expect(mockUpdateArea).toHaveBeenCalledWith('area-1', {
      name: 'Gôndola 1 - Cafés',
      description: 'Corredor central',
      product_ids: ['p1', 'p2'],
    });
    expect(mockShowMessage).toHaveBeenCalledWith(
      'Sucesso',
      'Área atualizada com sucesso!',
      expect.any(Function),
    );
  });

  test('bloqueia salvar sem nome ou sem nenhum produto selecionado', async () => {
    const user = userEvent.setup();
    await renderWithQuery();

    const nameInput = await screen.findByDisplayValue('Gôndola 1');
    await user.clear(nameInput);
    await user.press(screen.getByRole('button', { name: 'Salvar Alterações' }));
    expect(mockShowMessage).toHaveBeenCalledWith('Atenção', 'Informe o nome da área.');
    expect(mockUpdateArea).not.toHaveBeenCalled();

    await user.type(nameInput, 'Gôndola 1');
    await user.press(screen.getByText('Café Torrado'));
    await user.press(screen.getByRole('button', { name: 'Salvar Alterações' }));
    expect(mockShowMessage).toHaveBeenCalledWith(
      'Atenção',
      expect.stringContaining('Selecione ao menos um produto'),
    );
    expect(mockUpdateArea).not.toHaveBeenCalled();
  });

  test('confirma exclusão e chama deleteArea voltando para a lista', async () => {
    mockDeleteArea.mockResolvedValueOnce(undefined);
    mockConfirmAction.mockImplementationOnce((_title, _msg, onConfirm) => onConfirm());
    const user = userEvent.setup();
    await renderWithQuery();

    await screen.findByDisplayValue('Gôndola 1');
    await user.press(screen.getByRole('button', { name: 'Excluir Área' }));

    expect(mockConfirmAction).toHaveBeenCalledWith(
      'Excluir Área',
      expect.stringContaining('Gôndola 1'),
      expect.any(Function),
      { confirmText: 'Excluir', destructive: true },
    );
    expect(mockDeleteArea).toHaveBeenCalledWith('area-1');
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});
