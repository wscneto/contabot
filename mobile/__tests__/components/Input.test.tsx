import { Text } from 'react-native';
import { render, screen, userEvent } from '@testing-library/react-native';
import { Input } from '@/components/Input';

describe('<Input />', () => {
  test('mostra rótulo e repassa props ao TextInput', async () => {
    await render(<Input label="E-mail" placeholder="seu@email.com" keyboardType="email-address" />);
    expect(screen.getByText('E-mail')).toBeOnTheScreen();
    const input = screen.getByPlaceholderText('seu@email.com');
    expect(input).toHaveProp('keyboardType', 'email-address');
  });

  test('digitação chama onChangeText com o texto', async () => {
    const onChangeText = jest.fn();
    const user = userEvent.setup();
    await render(<Input placeholder="Nome" onChangeText={onChangeText} />);
    await user.type(screen.getByPlaceholderText('Nome'), 'Ana');
    expect(onChangeText).toHaveBeenLastCalledWith('Ana');
  });

  test('exibe o valor controlado', async () => {
    await render(<Input placeholder="Código" value="ANA1-2345" onChangeText={jest.fn()} />);
    expect(screen.getByPlaceholderText('Código')).toHaveDisplayValue('ANA1-2345');
  });

  test('erro tem prioridade sobre a dica', async () => {
    const { rerender } = await render(<Input hint="Mínimo 6 caracteres" />);
    expect(screen.getByText('Mínimo 6 caracteres')).toBeOnTheScreen();

    await rerender(<Input hint="Mínimo 6 caracteres" error="Senha muito curta" />);
    expect(screen.getByText('Senha muito curta')).toBeOnTheScreen();
    expect(screen.queryByText('Mínimo 6 caracteres')).not.toBeOnTheScreen();
  });

  test('editable={false} impede digitação', async () => {
    const onChangeText = jest.fn();
    const user = userEvent.setup();
    await render(<Input placeholder="Bloqueado" editable={false} onChangeText={onChangeText} />);
    await user.type(screen.getByPlaceholderText('Bloqueado'), 'abc');
    expect(onChangeText).not.toHaveBeenCalled();
  });

  test('secureTextEntry é repassado (senha não aparece em texto claro)', async () => {
    await render(<Input placeholder="Senha" secureTextEntry />);
    expect(screen.getByPlaceholderText('Senha')).toHaveProp('secureTextEntry', true);
  });

  test('renderiza ícones à esquerda e à direita', async () => {
    await render(<Input leftIcon={<Text>L</Text>} rightIcon={<Text>R</Text>} />);
    expect(screen.getByText('L')).toBeOnTheScreen();
    expect(screen.getByText('R')).toBeOnTheScreen();
  });
});
