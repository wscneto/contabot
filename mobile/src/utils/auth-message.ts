/** Traduz mensagens de erro do Supabase Auth para textos amigáveis em português. */
export function authMessage(message: string | undefined): string {
  if (!message) return 'Não foi possível entrar. Tente novamente.';
  if (/invalid login credentials/i.test(message)) return 'E-mail ou senha incorretos.';
  if (/email not confirmed/i.test(message)) return 'Confirme seu e-mail antes de entrar.';
  if (/already registered|already exists/i.test(message)) return 'Já existe um usuário cadastrado com este e-mail.';
  if (/password/i.test(message) && /6/.test(message)) return 'A senha deve ter pelo menos 6 caracteres.';
  if (/fetch|network/i.test(message)) return 'Não foi possível conectar ao servidor. Verifique sua conexão.';
  return message;
}
