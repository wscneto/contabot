/**
 * Login do funcionário por código de acesso (sem e-mail).
 *
 * Valida o código e devolve um token de link mágico de uso único; o app troca
 * esse token por uma sessão com supabase.auth.verifyOtp({ token_hash, type: 'magiclink' }).
 * Nenhum e-mail é enviado.
 */
import { hashAccessCode, normalizeAccessCode } from '../_shared/access-code.ts';
import { corsHeaders, fail, json, readJson } from '../_shared/http.ts';
import { adminClient } from '../_shared/supabase.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return fail(405, 'Use POST.');

  const body = await readJson(req);
  const code = normalizeAccessCode(String(body.code ?? ''));
  if (code.length !== 8) return fail(401, 'Código de acesso inválido. Deve ter 8 caracteres.');

  const admin = adminClient();
  const { data: access, error } = await admin
    .from('access_codes')
    .select('user_id, profiles!inner(active)')
    .eq('code_hash', await hashAccessCode(code))
    .maybeSingle();
  if (error) {
    console.error('join-store: consulta de código falhou', error);
    return fail(500, 'Não foi possível validar o código agora. Tente novamente.');
  }
  if (!access) return fail(401, 'Código de acesso não encontrado.');
  // deno-lint-ignore no-explicit-any
  if (!(access as any).profiles?.active) return fail(403, 'Este usuário foi desativado.');

  const { data: authUser, error: userError } = await admin.auth.admin.getUserById(access.user_id);
  if (userError || !authUser.user?.email) {
    console.error('join-store: usuário sem e-mail interno', userError);
    return fail(500, 'Cadastro do funcionário incompleto. Peça ao gerente um novo código.');
  }
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: authUser.user.email,
  });
  if (linkError || !link.properties?.hashed_token) {
    console.error('join-store: generateLink falhou', linkError);
    return fail(500, 'Não foi possível iniciar a sessão. Tente novamente.');
  }
  return json({ token_hash: link.properties.hashed_token });
});
