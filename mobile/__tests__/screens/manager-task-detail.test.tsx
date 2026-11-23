import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, userEvent } from '@testing-library/react-native';
import ManagerTaskDetailScreen from '@/app/(manager)/tasks/[id]';

const mockBack = jest.fn();
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, push: mockPush, replace: jest.fn() }),
  useLocalSearchParams: () => ({ id: 'task-1' }),
}));

jest.mock('../../src/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'mgr-1', name: 'Carla', role: 'manager' } }),
}));

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
}));

const mockGetTask = jest.fn();
const mockApproveTask = jest.fn();
const mockRequestRecount = jest.fn();
const mockDeleteTask = jest.fn();
jest.mock('../../src/services/api', () => ({
  api: {
    getTask: (...args: unknown[]) => mockGetTask(...args),
    approveTask: (...args: unknown[]) => mockApproveTask(...args),
    requestRecount: (...args: unknown[]) => mockRequestRecount(...args),
    deleteTask: (...args: unknown[]) => mockDeleteTask(...args),
    resolveMediaUrl: (u: string | null) => u,
  },
}));

const mockConfirmAction = jest.fn();
const mockShowMessage = jest.fn();
jest.mock('../../src/utils/confirm', () => ({
  confirmAction: (...args: unknown[]) => mockConfirmAction(...args),
  showMessage: (...args: unknown[]) => mockShowMessage(...args),
}));

jest.mock('../../src/utils/exportCsv', () => ({
  exportApprovedTaskCsv: jest.fn(),
}));

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ManagerTaskDetailScreen />
    </QueryClientProvider>,
  );
}

const submittedTask = {
  id: 'task-1',
  status: 'submitted',
  due_date: '2026-11-23',
  overdue: false,
  area: { id: 'a1', name: 'Gôndola 1' },
  assignee: { id: 'emp-1', name: 'Ana' },
  submitted_by: { id: 'emp-1', name: 'Ana' },
  items: [
    {
      product_id: 'p1',
      name: 'Café 500g',
      variant: 'Tradicional',
      photo: null,
      evidence_frame: null,
      previous: 10,
      ai_quantity: 8,
      ai_status: 'ok',
      ai_note: '',
      counted: 8,
      final: null,
    },
  ],
  events: [],
};

describe('ManagerTaskDetailScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  test('formata data de prazo em DD/MM/AAAA e permite editar quantidade antes de aprovar', async () => {
    mockGetTask.mockResolvedValue(submittedTask);
    mockApproveTask.mockResolvedValueOnce({ ...submittedTask, status: 'approved' });
    mockConfirmAction.mockImplementationOnce((_t, _m, onConfirm) => onConfirm());

    const user = userEvent.setup();
    await renderScreen();

    expect(await screen.findByText(/Prazo limite: 23\/11\/2026/)).toBeOnTheScreen();

    // Ajusta a quantidade de 8 para 9 usando o Stepper
    await user.press(screen.getByLabelText('Aumentar quantidade'));
    expect(screen.getByText('Ajustado')).toBeOnTheScreen();
    expect(screen.getByText('Desfazer ajustes (1)')).toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Aprovar com 1 Ajuste' }));

    expect(mockConfirmAction).toHaveBeenCalledWith(
      'Aprovar Contagem',
      expect.stringContaining('Você ajustou 1 item'),
      expect.any(Function),
      { confirmText: 'Aprovar e Gravar' },
    );
    expect(mockApproveTask).toHaveBeenCalledWith('task-1', { p1: 9 });
  });

  test('desfazer ajustes aprova sem overrides (undefined)', async () => {
    mockGetTask.mockResolvedValue(submittedTask);
    mockApproveTask.mockResolvedValueOnce({ ...submittedTask, status: 'approved' });
    mockConfirmAction.mockImplementationOnce((_t, _m, onConfirm) => onConfirm());

    const user = userEvent.setup();
    await renderScreen();

    await screen.findByText('Café 500g');
    await user.press(screen.getByLabelText('Aumentar quantidade'));
    await user.press(screen.getByText('Desfazer ajustes (1)'));

    expect(screen.queryByText('Ajustado')).not.toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Aprovar e Gravar Estoque' }));
    expect(mockApproveTask).toHaveBeenCalledWith('task-1', undefined);
  });

  test('exibe nota de auditoria em contagem aprovada quando o gerente ajustou um item', async () => {
    mockGetTask.mockResolvedValue({
      ...submittedTask,
      status: 'approved',
      items: [{ ...submittedTask.items[0], counted: 8, final: 9 }],
    });

    await renderScreen();
    expect(await screen.findByText('Ajustado na aprovação (equipe contou 8).')).toBeOnTheScreen();
  });
});
