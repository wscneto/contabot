import { render, screen, userEvent, fireEvent } from '@testing-library/react-native';
import { Stepper } from '@/components/Stepper';

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
}));

const renderStepper = async (props: Partial<React.ComponentProps<typeof Stepper>> = {}) => {
  const onChange = jest.fn();
  await render(<Stepper value={null} onChange={onChange} {...props} />);
  return {
    onChange,
    minus: screen.getByLabelText('Diminuir quantidade'),
    plus: screen.getByLabelText('Aumentar quantidade'),
    input: screen.getByPlaceholderText('—'),
  };
};

describe('<Stepper />', () => {
  test('mostra o valor atual no campo', async () => {
    const { input } = await renderStepper({ value: 7 });
    expect(input).toHaveDisplayValue('7');
  });

  test('valor null mostra campo vazio', async () => {
    const { input } = await renderStepper({ value: null });
    expect(input).toHaveDisplayValue('');
  });

  test('+ incrementa e - decrementa', async () => {
    const user = userEvent.setup();
    const { onChange, plus, minus } = await renderStepper({ value: 5 });
    await user.press(plus);
    expect(onChange).toHaveBeenLastCalledWith(6);
    await user.press(minus);
    expect(onChange).toHaveBeenLastCalledWith(4);
  });

  test('a partir de null: + vai para 1 e - vai para o mínimo', async () => {
    const user = userEvent.setup();
    const { onChange, plus, minus } = await renderStepper({ value: null, min: 0 });
    await user.press(plus);
    expect(onChange).toHaveBeenLastCalledWith(1);
    await user.press(minus);
    expect(onChange).toHaveBeenLastCalledWith(0);
  });

  test('no mínimo, "-" fica desabilitado e não altera o valor', async () => {
    const user = userEvent.setup();
    const { onChange, minus } = await renderStepper({ value: 0, min: 0 });
    expect(minus).toBeDisabled();
    await user.press(minus);
    expect(onChange).not.toHaveBeenCalled();
  });

  test('no máximo, "+" fica desabilitado e não altera o valor', async () => {
    const user = userEvent.setup();
    const { onChange, plus } = await renderStepper({ value: 10, max: 10 });
    expect(plus).toBeDisabled();
    await user.press(plus);
    expect(onChange).not.toHaveBeenCalled();
  });

  describe('digitação', () => {
    test('número válido é aceito', async () => {
      const { onChange, input } = await renderStepper({ value: 1 });
      await fireEvent.changeText(input, '42');
      expect(onChange).toHaveBeenLastCalledWith(42);
    });

    test('campo vazio (ou só espaços) vira null', async () => {
      const { onChange, input } = await renderStepper({ value: 3 });
      await fireEvent.changeText(input, '   ');
      expect(onChange).toHaveBeenLastCalledWith(null);
    });

    test.each([['abc'], ['-1'], ['100000']])('valor inválido ou fora da faixa "%s" é ignorado', async (text) => {
      const { onChange, input } = await renderStepper({ value: 3, min: 0, max: 99999 });
      await fireEvent.changeText(input, text);
      expect(onChange).not.toHaveBeenCalled();
    });

    test('respeita mínimo customizado', async () => {
      const { onChange, input } = await renderStepper({ value: 5, min: 2 });
      await fireEvent.changeText(input, '1');
      expect(onChange).not.toHaveBeenCalled();
    });

    test('campo é numérico e limitado a 5 caracteres', async () => {
      const { input } = await renderStepper();
      expect(input).toHaveProp('keyboardType', 'number-pad');
      expect(input).toHaveProp('maxLength', 5);
    });
  });
});
