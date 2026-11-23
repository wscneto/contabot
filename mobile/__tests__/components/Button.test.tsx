import { Text } from 'react-native';
import { render, screen, userEvent } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import { Button } from '@/components/Button';

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
}));

describe('<Button />', () => {
  beforeEach(() => jest.clearAllMocks());

  test('renderiza o título com papel e nome acessíveis', async () => {
    await render(<Button title="Salvar" onPress={jest.fn()} />);
    const button = screen.getByRole('button', { name: 'Salvar' });
    expect(button).toBeOnTheScreen();
    expect(button).toBeEnabled();
    expect(screen.getByText('Salvar')).toBeOnTheScreen();
  });

  test('chama onPress uma vez por toque e dispara haptics no nativo', async () => {
    const onPress = jest.fn();
    const user = userEvent.setup();
    await render(<Button title="Enviar" onPress={onPress} />);

    await user.press(screen.getByRole('button', { name: 'Enviar' }));

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(Haptics.impactAsync).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Light);
  });

  test('falha do haptics não impede o onPress', async () => {
    (Haptics.impactAsync as jest.Mock).mockRejectedValueOnce(new Error('sem motor de vibração'));
    const onPress = jest.fn();
    const user = userEvent.setup();
    await render(<Button title="Enviar" onPress={onPress} />);

    await user.press(screen.getByRole('button'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test('desabilitado: não chama onPress e expõe o estado acessível', async () => {
    const onPress = jest.fn();
    const user = userEvent.setup();
    await render(<Button title="Excluir" onPress={onPress} disabled />);

    const button = screen.getByRole('button', { name: 'Excluir' });
    expect(button).toBeDisabled();
    await user.press(button);

    expect(onPress).not.toHaveBeenCalled();
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
  });

  test('carregando: mostra spinner no lugar do texto, fica ocupado e não chama onPress', async () => {
    const onPress = jest.fn();
    const user = userEvent.setup();
    await render(<Button title="Entrar" onPress={onPress} loading />);

    // O texto some, mas o botão continua com nome acessível
    expect(screen.queryByText('Entrar')).not.toBeOnTheScreen();
    const button = screen.getByRole('button', { name: 'Entrar' });
    expect(button).toBeBusy();
    expect(button).toBeDisabled();

    await user.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  test('volta a aceitar toques quando o loading termina', async () => {
    const onPress = jest.fn();
    const user = userEvent.setup();
    const { rerender } = await render(<Button title="Entrar" onPress={onPress} loading />);
    await rerender(<Button title="Entrar" onPress={onPress} loading={false} />);

    await user.press(screen.getByRole('button', { name: 'Entrar' }));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button')).not.toBeBusy();
  });

  test('renderiza ícones à esquerda e à direita', async () => {
    await render(
      <Button title="Próximo" onPress={jest.fn()} icon={<Text>ICON-L</Text>} iconRight={<Text>ICON-R</Text>} />,
    );
    expect(screen.getByText('ICON-L')).toBeOnTheScreen();
    expect(screen.getByText('ICON-R')).toBeOnTheScreen();
  });

  test.each(['primary', 'secondary', 'outline', 'danger', 'ghost'] as const)(
    'variante %s renderiza e responde a toques',
    async (variant) => {
      const onPress = jest.fn();
      const user = userEvent.setup();
      await render(<Button title="Ok" variant={variant} size="sm" onPress={onPress} />);
      await user.press(screen.getByRole('button', { name: 'Ok' }));
      expect(onPress).toHaveBeenCalledTimes(1);
    },
  );
});
