import { act, render, screen, userEvent } from '@testing-library/react-native';
import LoginScreen from '@/app/(auth)/login';

let capturedOnBarcodeScanned: ((result: { data: string; type: string }) => void) | undefined;
jest.mock('expo-camera', () => {
  const { View: MockView } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    useCameraPermissions: () => [{ granted: true }, jest.fn(() => Promise.resolve({ granted: true }))],
    CameraView: ({ onBarcodeScanned }: any) => {
      capturedOnBarcodeScanned = onBarcodeScanned;
      return <MockView testID="mock-qr-camera" />;
    },
  };
});

const mockReplace = jest.fn();
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush, back: jest.fn() }),
}));

const mockLoginManager = jest.fn();
const mockLoginEmployee = jest.fn();
jest.mock('../../src/context/AuthContext', () => ({
  useAuth: () => ({ loginManager: mockLoginManager, loginEmployee: mockLoginEmployee }),
}));

// Evita criar o cliente Supabase real (SQLite/localStorage) no teste.
jest.mock('../../src/lib/supabase', () => ({ isSupabaseConfigured: true }));

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
}));

async function openManagerTab() {
  const user = userEvent.setup();
  await render(<LoginScreen />);
  await user.press(screen.getByText('Gerente'));
  return user;
}

describe('LoginScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('gerente', () => {
    test('enviar com e-mail e senha vazios mostra validação e não chama o login', async () => {
      const user = await openManagerTab();
      await user.press(screen.getByRole('button', { name: 'Entrar como Gerente' }));

      expect(screen.getByText('Preencha seu e-mail e senha.')).toBeOnTheScreen();
      expect(mockLoginManager).not.toHaveBeenCalled();
      expect(mockReplace).not.toHaveBeenCalled();
    });

    test('e-mail só com espaços conta como vazio', async () => {
      const user = await openManagerTab();
      await user.type(screen.getByPlaceholderText('seu@email.com'), '   ');
      await user.type(screen.getByPlaceholderText('Sua senha'), 'segredo');
      await user.press(screen.getByRole('button', { name: 'Entrar como Gerente' }));

      expect(screen.getByText('Preencha seu e-mail e senha.')).toBeOnTheScreen();
      expect(mockLoginManager).not.toHaveBeenCalled();
    });

    test('senha vazia bloqueia o envio', async () => {
      const user = await openManagerTab();
      await user.type(screen.getByPlaceholderText('seu@email.com'), 'carla@loja.com');
      await user.press(screen.getByRole('button', { name: 'Entrar como Gerente' }));

      expect(screen.getByText('Preencha seu e-mail e senha.')).toBeOnTheScreen();
      expect(mockLoginManager).not.toHaveBeenCalled();
    });

    test('a mensagem de validação some ao digitar', async () => {
      const user = await openManagerTab();
      await user.press(screen.getByRole('button', { name: 'Entrar como Gerente' }));
      expect(screen.getByText('Preencha seu e-mail e senha.')).toBeOnTheScreen();

      await user.type(screen.getByPlaceholderText('seu@email.com'), 'a');
      expect(screen.queryByText('Preencha seu e-mail e senha.')).not.toBeOnTheScreen();
    });

    test('credenciais preenchidas: chama loginManager com e-mail sem espaços e navega', async () => {
      mockLoginManager.mockResolvedValueOnce(undefined);
      const user = await openManagerTab();
      await user.type(screen.getByPlaceholderText('seu@email.com'), '  carla@loja.com ');
      await user.type(screen.getByPlaceholderText('Sua senha'), ' s3nh@ ');
      await user.press(screen.getByRole('button', { name: 'Entrar como Gerente' }));

      // A senha é enviada exatamente como digitada (espaços fazem parte dela)
      expect(mockLoginManager).toHaveBeenCalledWith('carla@loja.com', ' s3nh@ ');
      expect(mockReplace).toHaveBeenCalledWith('/(manager)');
    });

    test('erro do servidor é exibido e não há navegação', async () => {
      mockLoginManager.mockRejectedValueOnce(new Error('E-mail ou senha incorretos.'));
      const user = await openManagerTab();
      await user.type(screen.getByPlaceholderText('seu@email.com'), 'carla@loja.com');
      await user.type(screen.getByPlaceholderText('Sua senha'), 'errada');
      await user.press(screen.getByRole('button', { name: 'Entrar como Gerente' }));

      expect(await screen.findByText('E-mail ou senha incorretos.')).toBeOnTheScreen();
      expect(mockReplace).not.toHaveBeenCalled();
      // Depois do erro o botão volta a aceitar toques
      expect(screen.getByRole('button', { name: 'Entrar como Gerente' })).toBeEnabled();
    });

    test('erro sem mensagem usa texto padrão', async () => {
      mockLoginManager.mockRejectedValueOnce(new Error(''));
      const user = await openManagerTab();
      await user.type(screen.getByPlaceholderText('seu@email.com'), 'carla@loja.com');
      await user.type(screen.getByPlaceholderText('Sua senha'), 'x');
      await user.press(screen.getByRole('button', { name: 'Entrar como Gerente' }));

      expect(await screen.findByText('E-mail ou senha incorretos.')).toBeOnTheScreen();
    });

    test('link de cadastro leva para a tela de registro', async () => {
      const user = await openManagerTab();
      await user.press(screen.getByText('Cadastrar nova loja'));
      expect(mockPush).toHaveBeenCalledWith('/(auth)/register');
    });
  });

  describe('funcionário', () => {
    test('enviar sem código mostra validação e não chama o login', async () => {
      const user = userEvent.setup();
      await render(<LoginScreen />);
      await user.press(screen.getByRole('button', { name: 'Acessar Contagens' }));

      expect(screen.getByText('Informe o código de acesso recebido do gerente.')).toBeOnTheScreen();
      expect(mockLoginEmployee).not.toHaveBeenCalled();
    });

    test('código é convertido para maiúsculas e enviado sem espaços', async () => {
      mockLoginEmployee.mockResolvedValueOnce(undefined);
      const user = userEvent.setup();
      await render(<LoginScreen />);
      await user.type(screen.getByPlaceholderText('Ex: ANA1-2345'), 'ana1-2345 ');
      await user.press(screen.getByRole('button', { name: 'Acessar Contagens' }));

      expect(mockLoginEmployee).toHaveBeenCalledWith('ANA1-2345');
      expect(mockReplace).toHaveBeenCalledWith('/(employee)');
    });

    test('trocar de aba limpa a mensagem de erro', async () => {
      const user = userEvent.setup();
      await render(<LoginScreen />);
      await user.press(screen.getByRole('button', { name: 'Acessar Contagens' }));
      expect(screen.getByText('Informe o código de acesso recebido do gerente.')).toBeOnTheScreen();

      await user.press(screen.getByText('Gerente'));
      expect(screen.queryByText('Informe o código de acesso recebido do gerente.')).not.toBeOnTheScreen();
    });

    test('escanear QR Code preenche o código e faz login automaticamente', async () => {
      capturedOnBarcodeScanned = undefined;
      mockLoginEmployee.mockResolvedValueOnce(undefined);
      const user = userEvent.setup();
      await render(<LoginScreen />);

      await user.press(screen.getByRole('button', { name: 'Escanear QR Code' }));
      expect(screen.getByTestId('mock-qr-camera')).toBeOnTheScreen();

      await act(async () => {
        capturedOnBarcodeScanned?.({ data: JSON.stringify({ code: 'ANA1-2345' }), type: 'qr' });
      });

      expect(mockLoginEmployee).toHaveBeenCalledWith('ANA1-2345');
      expect(mockReplace).toHaveBeenCalledWith('/(employee)');
    });
  });
});
