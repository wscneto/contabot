import { Text } from 'react-native';
import { act, render, screen, userEvent } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';
import { QRCodeModal } from '@/components/QRCodeModal';

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(() => Promise.resolve(true)) }));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: { Success: 'success' },
}));
// O QR em SVG não importa aqui; só o conteúdo codificado.
jest.mock('react-native-qrcode-svg', () => {
  const { Text: MockText } = jest.requireActual<typeof import('react-native')>('react-native');
  return function MockQRCode({ value }: { value: string }) {
    return <MockText testID="qr-value">{value}</MockText>;
  };
});

describe('<QRCodeModal />', () => {
  beforeEach(() => jest.clearAllMocks());

  const renderModal = (onClose = jest.fn()) =>
    render(<QRCodeModal visible onClose={onClose} memberName="Ana Balcão" accessCode=" ANA1-2345 " />);

  test('mostra o nome do funcionário e o código de acesso', async () => {
    await renderModal();
    expect(screen.getByText('Ana Balcão')).toBeOnTheScreen();
    expect(screen.getByText(' ANA1-2345 ')).toBeOnTheScreen();
  });

  test('o QR carrega apenas o código (sem URL do servidor nem segredos)', async () => {
    await renderModal();
    const payload = JSON.parse(String(screen.getByTestId('qr-value').props.children));
    expect(payload).toEqual({ code: ' ANA1-2345 ' });
  });

  test('copiar coloca o código sem espaços na área de transferência e mostra confirmação temporária', async () => {
    jest.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    await renderModal();

    await user.press(screen.getByLabelText('Copiar código'));
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith('ANA1-2345');
    expect(await screen.findByText('Código copiado!')).toBeOnTheScreen();

    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(screen.queryByText('Código copiado!')).not.toBeOnTheScreen();
    jest.useRealTimers();
  });

  test('"Concluído" fecha o modal', async () => {
    const onClose = jest.fn();
    const user = userEvent.setup();
    await renderModal(onClose);
    await user.press(screen.getByRole('button', { name: 'Concluído' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('não renderiza conteúdo quando invisível', async () => {
    await render(
      <>
        <Text>fora</Text>
        <QRCodeModal visible={false} onClose={jest.fn()} memberName="Ana" accessCode="X" />
      </>,
    );
    expect(screen.queryByText('Convite para Equipe')).not.toBeOnTheScreen();
  });
});
