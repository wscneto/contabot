/**
 * Cadastro de funcionário pelo gerente. Cria o usuário de autenticação (e-mail
 * interno, nunca usado para login) e devolve o código de acesso em texto uma
 * única vez; o banco guarda só o hash.
 */
import { generateAccessCode, hashAccessCode } from '../_shared/access-code.ts';
import { corsHeaders, fail, json, readJson } from '../_shared/http.ts';
import { adminClient, requireCaller } from '../_shared/supabase.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return fail(405, 'Use POST.');

  const caller = await requireCaller(req);
  if (!caller) return fail(401, 'Sessão inválida ou expirada. Faça login novamente.');
  if (caller.user.role !== 'manager') return fail(403, 'Acesso restrito ao gerente da loja.');

  const body = await readJson(req);
  const name = String(body.name ?? '').trim();
  if (name.length < 1 || name.length > 100) return fail(422, 'Informe o nome do funcionário (até 100 caracteres).');

  const admin = adminClient();
  const { data: created, error } = await admin.auth.admin.createUser({
    email: `funcionario-${crypto.randomUUID()}@contabot.invalid`,
    email_confirm: true,
    password: crypto.randomUUID() + crypto.randomUUID(),
    app_metadata: { contabot_role: 'employee', store_id: caller.store.id },
    user_metadata: { name },
  });
  if (error || !created.user) {
    console.error('create-employee: createUser falhou', error);
    return fail(500, 'Não foi possível cadastrar o funcionário.');
  }
  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .insert({ id: created.user.id, store_id: caller.store.id, name, role: 'employee' })
    .select('id, name, role, email, active, created_at')
    .single();
  if (profileError || !profile) {
    console.error('create-employee: perfil não criado', profileError);
    await admin.auth.admin.deleteUser(created.user.id);
    return fail(500, 'Não foi possível cadastrar o funcionário.');
  }

  // Colisão de código é improvável (32^8); ainda assim, tenta de novo.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateAccessCode();
    const { error: codeError } = await admin
      .from('access_codes')
      .insert({ user_id: created.user.id, code_hash: await hashAccessCode(code.raw) });
    if (!codeError) return json({ user: profile, access_code: code.formatted }, 201);
    if (codeError.code !== '23505') {
      console.error('create-employee: gravação do código falhou', codeError);
      break;
    }
  }
  await admin.auth.admin.deleteUser(created.user.id);
  return fail(500, 'Não foi possível gerar o código de acesso.');
});
