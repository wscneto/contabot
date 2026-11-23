import { Text } from 'react-native';
import { render, screen, userEvent } from '@testing-library/react-native';
import { Header } from '@/components/Header';

const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, push: jest.fn(), replace: jest.fn() }),
}));

describe('<Header />', () => {
  beforeEach(() => mockBack.mockClear());

  test('mostra título e subtítulo', async () => {
    await render(<Header title="Produtos" subtitle="32 itens" />);
    expect(screen.getByText('Produtos')).toBeOnTheScreen();
    expect(screen.getByText('32 itens')).toBeOnTheScreen();
  });

  test('sem showBack não exibe botão de voltar', async () => {
    await render(<Header title="Início" />);
    expect(screen.queryByLabelText('Voltar')).not.toBeOnTheScreen();
  });

  test('botão voltar usa router.back() por padrão', async () => {
    const user = userEvent.setup();
    await render(<Header title="Detalhes" showBack />);
    await user.press(screen.getByLabelText('Voltar'));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  test('onBack customizado substitui o router.back()', async () => {
    const onBack = jest.fn();
    const user = userEvent.setup();
    await render(<Header title="Fotos" showBack onBack={onBack} />);
    await user.press(screen.getByLabelText('Voltar'));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(mockBack).not.toHaveBeenCalled();
  });

  test('renderiza a ação da direita', async () => {
    await render(<Header title="Equipe" rightAction={<Text>Adicionar</Text>} />);
    expect(screen.getByText('Adicionar')).toBeOnTheScreen();
  });

  test('título longo fica em uma linha', async () => {
    const long = 'Contagem '.repeat(40).trim();
    await render(<Header title={long} />);
    expect(screen.getByText(long)).toHaveProp('numberOfLines', 1);
  });
});
