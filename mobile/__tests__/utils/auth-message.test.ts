import { authMessage } from '@/utils/auth-message';

describe('authMessage', () => {
  test.each([
    [undefined, 'Não foi possível entrar. Tente novamente.'],
    ['', 'Não foi possível entrar. Tente novamente.'],
    ['Invalid login credentials', 'E-mail ou senha incorretos.'],
    ['Email not confirmed', 'Confirme seu e-mail antes de entrar.'],
    ['User already registered', 'Já existe um usuário cadastrado com este e-mail.'],
    ['A user with this email address already exists', 'Já existe um usuário cadastrado com este e-mail.'],
    ['Password should be at least 6 characters.', 'A senha deve ter pelo menos 6 caracteres.'],
    ['TypeError: Failed to fetch', 'Não foi possível conectar ao servidor. Verifique sua conexão.'],
    ['Network request failed', 'Não foi possível conectar ao servidor. Verifique sua conexão.'],
  ])('traduz %p', (input, expected) => {
    expect(authMessage(input)).toBe(expected);
  });

  test('mensagens desconhecidas são repassadas sem alteração', () => {
    expect(authMessage('Rate limit exceeded')).toBe('Rate limit exceeded');
  });

  test('não confunde mensagens de senha sem o número 6', () => {
    expect(authMessage('Password is too weak')).toBe('Password is too weak');
  });
});
