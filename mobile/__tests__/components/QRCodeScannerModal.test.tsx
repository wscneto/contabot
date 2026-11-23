import { Platform, Text } from 'react-native';
import { act, render, screen, userEvent } from '@testing-library/react-native';
import { QRCodeScannerModal } from '@/components/QRCodeScannerModal';

let mockPermission: { granted: boolean } | null = { granted: true };
const mockRequestPermission = jest.fn(() => Promise.resolve({ granted: true }));
let capturedOnBarcodeScanned: ((result: { data: string; type: string }) => void) | undefined;
let capturedEnableTorch: boolean | undefined;

jest.mock('expo-camera', () => {
  const { View: MockView } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    useCameraPermissions: () => [mockPermission, mockRequestPermission],
    CameraView: ({ onBarcodeScanned, enableTorch }: any) => {
      capturedOnBarcodeScanned = onBarcodeScanned;
      capturedEnableTorch = enableTorch;
      return <MockView testID="mock-camera-view" />;
    },
  };
});

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
}));

describe('<QRCodeScannerModal />', () => {
  const originalOS = Platform.OS;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPermission = { granted: true };
    capturedOnBarcodeScanned = undefined;
    capturedEnableTorch = undefined;
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
  });

  afterAll(() => {
    Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
  });

  test('não renderiza conteúdo quando invisível', async () => {
    await render(
      <>
        <Text>fora</Text>
        <QRCodeScannerModal visible={false} onClose={jest.fn()} onCodeScanned={jest.fn()} />
      </>,
    );
    expect(screen.queryByText('Escanear Convite')).not.toBeOnTheScreen();
  });

  test('na web exibe aviso orientando digitar o código manualmente', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
    const onClose = jest.fn();
    const user = userEvent.setup();
    await render(<QRCodeScannerModal visible onClose={onClose} onCodeScanned={jest.fn()} />);

    expect(screen.getByText('Leitura de QR no App Mobile')).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Fechar' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('mostra indicador enquanto permissão ainda carrega', async () => {
    mockPermission = null;
    await render(<QRCodeScannerModal visible onClose={jest.fn()} onCodeScanned={jest.fn()} />);
    expect(screen.queryByTestId('mock-camera-view')).not.toBeOnTheScreen();
    expect(screen.queryByText('Permissão de Câmera Necessária')).not.toBeOnTheScreen();
  });

  test('quando permissão negada, permite solicitar câmera ou voltar para digitação', async () => {
    mockPermission = { granted: false };
    const onClose = jest.fn();
    const user = userEvent.setup();
    await render(<QRCodeScannerModal visible onClose={onClose} onCodeScanned={jest.fn()} />);

    expect(screen.getByText('Permissão de Câmera Necessária')).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Permitir Acesso à Câmera' }));
    expect(mockRequestPermission).toHaveBeenCalledTimes(1);

    await user.press(screen.getByRole('button', { name: 'Digitar código manualmente' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('com câmera autorizada: lê QR válido uma única vez, avisa QR inválido e alterna lanterna', async () => {
    const onClose = jest.fn();
    const onCodeScanned = jest.fn();
    const user = userEvent.setup();
    await render(<QRCodeScannerModal visible onClose={onClose} onCodeScanned={onCodeScanned} />);

    expect(screen.getByTestId('mock-camera-view')).toBeOnTheScreen();
    expect(capturedEnableTorch).toBe(false);

    // Liga e desliga a lanterna
    await user.press(screen.getByLabelText('Ligar lanterna'));
    expect(capturedEnableTorch).toBe(true);
    await user.press(screen.getByLabelText('Desligar lanterna'));
    expect(capturedEnableTorch).toBe(false);

    // QR de outro site mostra erro sem fechar nem disparar callback
    await act(async () => {
      capturedOnBarcodeScanned?.({ data: 'https://exemplo.com', type: 'qr' });
    });
    expect(screen.getByText(/QR Code não reconhecido/)).toBeOnTheScreen();
    expect(onCodeScanned).not.toHaveBeenCalled();

    // QR válido dispara onCodeScanned uma única vez mesmo se a câmera emitir eventos repetidos
    await act(async () => {
      capturedOnBarcodeScanned?.({ data: JSON.stringify({ code: 'ana12345' }), type: 'qr' });
      capturedOnBarcodeScanned?.({ data: JSON.stringify({ code: 'ANA1-2345' }), type: 'qr' });
    });
    expect(onCodeScanned).toHaveBeenCalledTimes(1);
    expect(onCodeScanned).toHaveBeenCalledWith('ANA1-2345');

    // Fechar pelo botão X
    await user.press(screen.getByLabelText('Fechar leitor de QR Code'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
