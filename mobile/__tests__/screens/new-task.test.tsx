import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, userEvent } from '@testing-library/react-native';
import NewTaskScreen from '@/app/(manager)/tasks/new';

const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, push: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));

jest.mock('../../src/context/AuthContext', () => ({
  useAuth: () => ({
    store: { id: 'store-1', name: 'Loja Centro' },
    user: { id: 'mgr-1', name: 'Carla', role: 'manager' },
  }),
}));

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
}));

const mockListAreas = jest.fn();
const mockListTeam = jest.fn();
const mockCreateTasks = jest.fn();
jest.mock('../../src/services/api', () => ({
  api: {
    listAreas: (...args: unknown[]) => mockListAreas(...args),
    listTeam: (...args: unknown[]) => mockListTeam(...args),
    createTasks: (...args: unknown[]) => mockCreateTasks(...args),
    getStoreSettings: jest.fn(() => Promise.resolve({ default_counting_instruction: 'Instrução padrão' })),
  },
}));

const mockShowMessage = jest.fn();
const mockConfirmAction = jest.fn();
jest.mock('../../src/utils/confirm', () => ({
  showMessage: (...args: unknown[]) => mockShowMessage(...args),
  confirmAction: (...args: unknown[]) => mockConfirmAction(...args),
}));

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <NewTaskScreen />
    </QueryClientProvider>,
  );
}

describe('NewTaskScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListAreas.mockResolvedValue([{ id: 'a1', name: 'Gôndola 1', product_count: 4 }]);
    mockListTeam.mockResolvedValue([
      { id: 'mgr-1', name: 'Carla', role: 'manager', active: true, open_tasks: 0 },
      { id: 'emp-1', name: 'Ana', role: 'employee', active: true, open_tasks: 1 },
    ]);
  });

  test('converte data digitada em DD/MM/AAAA para ISO ao criar contagem', async () => {
    mockCreateTasks.mockResolvedValueOnce([{ id: 't1' }]);
    const user = userEvent.setup();
    await renderScreen();

    await user.press(await screen.findByText('Gôndola 1'));
    const dateInput = screen.getByPlaceholderText('Ex: 23/11/2026');
    await user.clear(dateInput);
    await user.type(dateInput, '15122026');

    expect(dateInput).toHaveDisplayValue('15/12/2026');

    await user.press(screen.getByRole('button', { name: 'Criar e Agendar Contagem' }));
    expect(mockCreateTasks).toHaveBeenCalledWith({
      area_ids: ['a1'],
      assignee_id: null,
      due_date: '2026-12-15',
      note: '',
    });
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  test('chip "Sem prazo" limpa o campo e envia due_date null', async () => {
    mockCreateTasks.mockResolvedValueOnce([{ id: 't1' }]);
    const user = userEvent.setup();
    await renderScreen();

    await user.press(await screen.findByText('Gôndola 1'));
    await user.press(screen.getByText('Sem prazo'));
    await user.press(screen.getByRole('button', { name: 'Criar e Agendar Contagem' }));

    expect(mockCreateTasks).toHaveBeenCalledWith({
      area_ids: ['a1'],
      assignee_id: null,
      due_date: null,
      note: '',
    });
  });

  test('rejeita data inválida em DD/MM/AAAA sem chamar createTasks', async () => {
    const user = userEvent.setup();
    await renderScreen();

    await user.press(await screen.findByText('Gôndola 1'));
    const dateInput = screen.getByPlaceholderText('Ex: 23/11/2026');
    await user.clear(dateInput);
    await user.type(dateInput, '31022026');
    await user.press(screen.getByRole('button', { name: 'Criar e Agendar Contagem' }));

    expect(mockShowMessage).toHaveBeenCalledWith(
      'Data inválida',
      expect.stringContaining('DD/MM/AAAA'),
    );
    expect(mockCreateTasks).not.toHaveBeenCalled();
  });
});
