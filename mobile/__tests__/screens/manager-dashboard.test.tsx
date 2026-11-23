import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, userEvent } from '@testing-library/react-native';
import ManagerDashboardScreen from '@/app/(manager)/(tabs)/index';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn() }),
}));

jest.mock('../../src/context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'mgr-1', name: 'Carla', role: 'manager' },
    store: { id: 's1', name: 'Mercadinho Centro' },
  }),
}));

const mockGetDashboard = jest.fn();
const mockListProducts = jest.fn();
const mockListAreas = jest.fn();
jest.mock('../../src/services/api', () => ({
  api: {
    getDashboard: (...args: unknown[]) => mockGetDashboard(...args),
    listProducts: (...args: unknown[]) => mockListProducts(...args),
    listAreas: (...args: unknown[]) => mockListAreas(...args),
  },
}));

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ManagerDashboardScreen />
    </QueryClientProvider>,
  );
}

describe('ManagerDashboardScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  test('exibe checklist de primeiros passos para loja nova e permite ocultar', async () => {
    mockGetDashboard.mockResolvedValue({
      counts: { to_approve: 0, in_progress: 0, open: 0, overdue: 0 },
      to_approve: [],
      low_stock: [],
      stale_areas: [],
      recent: [],
    });
    mockListProducts.mockResolvedValue([]);
    mockListAreas.mockResolvedValue([]);

    const user = userEvent.setup();
    await renderScreen();

    expect(await screen.findByText('Primeiros passos da loja')).toBeOnTheScreen();
    expect(screen.getByText('0 de 3 concluídos')).toBeOnTheScreen();

    await user.press(screen.getByLabelText('Ocultar guia inicial'));
    expect(screen.queryByText('Primeiros passos da loja')).not.toBeOnTheScreen();
  });

  test('não exibe checklist quando loja já tem produtos com foto, área e contagem; KPIs passam filtro', async () => {
    mockGetDashboard.mockResolvedValue({
      counts: { to_approve: 2, in_progress: 1, open: 0, overdue: 0 },
      to_approve: [],
      low_stock: [],
      stale_areas: [],
      recent: [],
    });
    mockListProducts.mockResolvedValue([{ id: 'p1', name: 'Café', photos: ['https://cdn/1.jpg'] }]);
    mockListAreas.mockResolvedValue([{ id: 'a1', name: 'Gôndola 1' }]);

    const user = userEvent.setup();
    await renderScreen();

    await screen.findByText('Para Aprovar');
    expect(screen.queryByText('Primeiros passos da loja')).not.toBeOnTheScreen();

    await user.press(screen.getByText('Para Aprovar'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/(manager)/tasks',
      params: { initialFilter: 'submitted' },
    });
  });
});
