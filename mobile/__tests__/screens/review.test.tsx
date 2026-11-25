import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { render, screen, userEvent } from '@testing-library/react-native';
import ReviewScreen from '@/app/task/[id]/review';

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: jest.fn(), dismissTo: jest.fn() }),
  useLocalSearchParams: () => ({ id: 'task-1' }),
}));

jest.mock('../../src/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'emp-1', name: 'Ana', role: 'employee' } }),
}));

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: { Success: 'success' },
}));

const mockGetTask = jest.fn();
jest.mock('../../src/services/api', () => ({
  api: {
    getTask: (...args: unknown[]) => mockGetTask(...args),
    submitTask: jest.fn(),
    approveTask: jest.fn(),
    resolveMediaUrl: (u: string | null) => u,
  },
}));

jest.mock('../../src/services/capture', () => ({
  initialReviewCounts: (items: any[]) =>
    Object.fromEntries(
      items.map((item) => [
        item.product_id,
        item.counted ?? (item.ai_quantity ?? null),
      ]),
    ),
}));

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      <QueryClientProvider client={client}>
        <ReviewScreen />
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
}

describe('ReviewScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  test('ordena itens com alerta antes dos ok e permite filtrar pendentes de revisão', async () => {
    mockGetTask.mockResolvedValue({
      id: 'task-1',
      status: 'review',
      area: { id: 'a1', name: 'Gôndola 1' },
      items: [
        { product_id: 'p-ok', name: 'Açúcar', ai_status: 'ok', ai_quantity: 5, counted: 5, ai_note: '', photo: null, evidence_frame: null },
        { product_id: 'p-check', name: 'Café', ai_status: 'check', ai_quantity: 3, counted: 3, ai_note: 'Parcial', photo: null, evidence_frame: null },
        { product_id: 'p-missing', name: 'Leite', ai_status: 'missing', ai_quantity: null, counted: null, ai_note: 'Não visto', photo: null, evidence_frame: null },
      ],
    });

    const user = userEvent.setup();
    await renderScreen();

    expect(await screen.findByText('Todos (3)')).toBeOnTheScreen();
    expect(screen.getByText('Pendentes de revisão (2)')).toBeOnTheScreen();

    // Filtra apenas pendentes de revisão: Açúcar (ok com valor 5) sai da lista
    await user.press(screen.getByText('Pendentes de revisão (2)'));
    expect(screen.queryByText('Açúcar')).not.toBeOnTheScreen();
    expect(screen.getByText('Café')).toBeOnTheScreen();
    expect(screen.getByText('Leite')).toBeOnTheScreen();

    // Volta para Todos
    await user.press(screen.getByText('Todos (3)'));
    expect(screen.getByText('Açúcar')).toBeOnTheScreen();
  });

  test('quando nenhum item está pendente, mostra estado vazio amigável no filtro', async () => {
    mockGetTask.mockResolvedValue({
      id: 'task-1',
      status: 'review',
      area: { id: 'a1', name: 'Gôndola 1' },
      items: [
        { product_id: 'p-ok', name: 'Açúcar', ai_status: 'ok', ai_quantity: 5, counted: 5, ai_note: '', photo: null, evidence_frame: null },
      ],
    });

    const user = userEvent.setup();
    await renderScreen();

    await user.press(await screen.findByText('Pendentes de revisão (0)'));
    expect(screen.getByText('Nenhum item pendente de revisão')).toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Ver todos os itens' }));
    expect(screen.getByText('Açúcar')).toBeOnTheScreen();
  });

  test('item com marcações da IA abre o quadro com as unidades desenhadas', async () => {
    const frame = 'loja/captures/c1/f0004.jpg';
    mockGetTask.mockResolvedValue({
      id: 'task-1',
      status: 'review',
      area: { id: 'a1', name: 'Gôndola 1' },
      items: [
        {
          product_id: 'p-ok',
          name: 'Açúcar',
          ai_status: 'ok',
          ai_quantity: 3,
          counted: 3,
          ai_note: '3 unidades marcadas na imagem.',
          photo: null,
          evidence_frame: frame,
          ai_marks: {
            frame,
            width: 1024,
            height: 576,
            boxes: [[10, 10, 100, 100], [110, 10, 200, 100], [210, 10, 300, 100]],
            marked: 3,
            duplicates_removed: 0,
            method: 'marked',
            facings: null,
            depth: null,
            depth_frame: null,
          },
        },
      ],
    });

    const user = userEvent.setup();
    await renderScreen();

    await user.press(await screen.findByText('Ver unidades marcadas (3 unidades marcadas pela IA)'));
    expect(screen.getByText('Frame Usado: Açúcar')).toBeOnTheScreen();
    expect(screen.getByLabelText('Ocultar marcações')).toBeOnTheScreen();
  });
});
