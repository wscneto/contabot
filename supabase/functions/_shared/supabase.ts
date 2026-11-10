import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

const url = () => Deno.env.get('SUPABASE_URL') ?? '';

/** Cliente com service role: ignora RLS. Use só depois de validar o chamador. */
export function adminClient(): SupabaseClient {
  return createClient(url(), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Cliente que age como o usuário do token: RLS e RPCs valem normalmente. */
export function userClient(token: string): SupabaseClient {
  return createClient(url(), Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function bearerToken(req: Request): string | null {
  const header = req.headers.get('Authorization') ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

export interface Caller {
  token: string;
  user: { id: string; name: string; role: 'manager' | 'employee' };
  store: { id: string; name: string };
}

/** Valida a sessão do chamador pela RPC whoami (perfil ativo obrigatório). */
export async function requireCaller(req: Request): Promise<Caller | null> {
  const token = bearerToken(req);
  if (!token) return null;
  const { data, error } = await userClient(token).rpc('whoami');
  if (error || !data?.user) return null;
  return { token, user: data.user, store: data.store };
}
