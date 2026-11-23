import { Text } from 'react-native';
import { render, screen, userEvent } from '@testing-library/react-native';
import { Card } from '@/components/Card';

describe('<Card />', () => {
  test('renderiza os filhos', async () => {
    await render(
      <Card>
        <Text>Conteúdo do card</Text>
      </Card>,
    );
    expect(screen.getByText('Conteúdo do card')).toBeOnTheScreen();
  });

  test('com onPress, um toque no conteúdo chama o handler', async () => {
    const onPress = jest.fn();
    const user = userEvent.setup();
    await render(
      <Card onPress={onPress}>
        <Text>Produto</Text>
      </Card>,
    );
    await user.press(screen.getByText('Produto'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test.each(['elevated', 'flat', 'outlined'] as const)('variante %s renderiza', async (variant) => {
    await render(
      <Card variant={variant}>
        <Text>{variant}</Text>
      </Card>,
    );
    expect(screen.getByText(variant)).toBeOnTheScreen();
  });

  test('aplica o estilo extra recebido por props', async () => {
    await render(
      <Card style={{ marginBottom: 99 }}>
        <Text>estilizado</Text>
      </Card>,
    );
    expect(screen.getByText('estilizado').parent).toHaveStyle({ marginBottom: 99 });
  });
});
