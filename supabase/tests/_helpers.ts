/**
 * Utilitários compartilhados pelos testes de integração, segurança, concorrência
 * e fuzzing. Todos rodam contra o Supabase local (banco + storage + Edge Functions
 * com VISION_PROVIDER=mock) e criam lojas descartáveis com e-mails aleatórios.
 */
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

export const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? 'http://127.0.0.1:54321';
export const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
export const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

if (!ANON_KEY || !SERVICE_KEY) {
  throw new Error('Defina SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY (veja README → Testes).');
}

export const image = await Deno.readFile(new URL('../seed/images/product-choco.jpg', import.meta.url));

/** Opções dos testes que usam supabase-js (timers de refresh ficam abertos). */
export const net = { sanitizeOps: false, sanitizeResources: false } as const;

export const client = (): SupabaseClient =>
  createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

export const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** Cliente que envia um token arbitrário (forjado, adulterado, expirado...). */
export const withToken = (token: string): SupabaseClient =>
  createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

// deno-lint-ignore no-explicit-any
export type Json = any;

export async function rpc(sb: SupabaseClient, fn: string, args: Record<string, unknown> = {}): Promise<Json> {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data;
}

/** Resultado bruto da RPC, para inspecionar a mensagem de erro sem lançar. */
export async function tryRpc(sb: SupabaseClient, fn: string, args: Record<string, unknown> = {}) {
  const { data, error } = await sb.rpc(fn, args);
  return { data, error: error ? { message: error.message, code: error.code } : null };
}

export async function invoke(sb: SupabaseClient, name: string, body: Record<string, unknown>): Promise<Json> {
  const { data, error } = await sb.functions.invoke(name, { body });
  if (error) {
    const detail = await error.context?.json?.().catch(() => null);
    throw new Error(`${name}: ${detail?.detail ?? error.message}`);
  }
  return data;
}

/** Chamada HTTP crua a uma Edge Function (status + corpo), sem supabase-js. */
export async function callFunction(
  name: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: Json; headers: Headers }> {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: Json = text;
  try {
    parsed = JSON.parse(text);
  } catch { /* corpo não-JSON */ }
  return { status: response.status, body: parsed, headers: response.headers };
}

export interface Manager {
  sb: SupabaseClient;
  id: string;
  email: string;
  storeId: string;
  accessToken: string;
}

export async function newManager(storeName = 'Loja Teste', metadata: Record<string, unknown> = {}): Promise<Manager> {
  const sb = client();
  const email = `gerente-${crypto.randomUUID().slice(0, 8)}@teste.contabot.app`;
  const { data, error } = await sb.auth.signUp({
    email,
    password: 'senha-forte-123',
    options: { data: { name: 'Gerente Teste', store_name: storeName, ...metadata } },
  });
  if (error || !data.session) {
    throw new Error(`signUp: ${error?.message ?? 'sem sessão (confirmação de e-mail ligada?)'}`);
  }
  const me = await rpc(sb, 'whoami');
  return { sb, id: me.user.id, email, storeId: me.store.id, accessToken: data.session.access_token };
}

export interface Employee {
  sb: SupabaseClient;
  id: string;
  code: string;
  accessToken: string;
  refreshToken: string;
}

export async function newEmployee(manager: Manager, name = 'Funcionário Teste'): Promise<Employee> {
  const created = await invoke(manager.sb, 'create-employee', { name });
  const sb = client();
  const joined = await invoke(sb, 'join-store', { code: created.access_code });
  const { data, error } = await sb.auth.verifyOtp({ token_hash: joined.token_hash, type: 'magiclink' });
  if (error || !data.session) throw new Error(`verifyOtp: ${error?.message}`);
  return {
    sb,
    id: created.user.id,
    code: created.access_code,
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
  };
}

export async function uploadProductPhoto(manager: Manager): Promise<string> {
  const path = `${manager.storeId}/products/${crypto.randomUUID()}.jpg`;
  const { error } = await manager.sb.storage.from('media').upload(path, image, { contentType: 'image/jpeg' });
  if (error) throw new Error(`upload: ${error.message}`);
  return path;
}

export interface Store {
  manager: Manager;
  photo: string;
  products: Json[];
  area: Json;
  task: Json;
}

/** Loja com 2 produtos (com foto), 1 área e 1 contagem aberta. */
export async function newStore(name = 'Loja Teste', assigneeId: string | null = null): Promise<Store> {
  const manager = await newManager(name);
  return await populateStore(manager, assigneeId);
}

export async function populateStore(manager: Manager, assigneeId: string | null = null): Promise<Store> {
  const photo = await uploadProductPhoto(manager);
  const products = [
    await rpc(manager.sb, 'create_product', { p_name: 'Chocolate', p_variant: '90 g', p_photos: [photo] }),
    await rpc(manager.sb, 'create_product', { p_name: 'Biscoito', p_photos: [photo] }),
  ];
  const area = await rpc(manager.sb, 'create_area', {
    p_name: `Gôndola ${crypto.randomUUID().slice(0, 4)}`,
    p_product_ids: products.map((p) => p.id),
  });
  const [task] = await rpc(manager.sb, 'create_tasks', { p_area_ids: [area.id], p_assignee_id: assigneeId });
  return { manager, photo, products, area, task };
}

/** Contagens válidas para todos os itens da contagem. */
export const countsFor = (products: Json[], value: number | null = 1) =>
  Object.fromEntries(products.map((p: Json) => [p.id, value]));

/**
 * Mensagens que denunciam detalhes internos do banco (nomes de tabelas,
 * constraints, tipos, pilha). O app deve receber só mensagens amigáveis.
 */
const LEAK_PATTERNS = [
  /violates/i,
  /relation\s+"/i,
  /constraint\s+"/i,
  /column\s+"/i,
  /out of range for type/i,
  /invalid input syntax/i,
  /PL\/pgSQL/i,
  /SQLSTATE/i,
  /syntax error at or near/i,
  /\bat character \d+/i,
];

export function assertNoInternalLeak(message: string | undefined | null, context = '') {
  for (const pattern of LEAK_PATTERNS) {
    assert(!pattern.test(message ?? ''), `${context} vazou detalhe interno do banco: ${message}`);
  }
}

/** Espera que a RPC falhe com mensagem amigável (sem vazar detalhes internos). */
export async function expectFriendlyError(
  sb: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
  includes?: string | RegExp,
): Promise<string> {
  const { error } = await tryRpc(sb, fn, args);
  assert(error, `${fn}(${JSON.stringify(args).slice(0, 200)}) deveria falhar`);
  assertNoInternalLeak(error.message, fn);
  if (includes instanceof RegExp) assert(includes.test(error.message), `${fn}: "${error.message}" !~ ${includes}`);
  else if (includes) assert(error.message.includes(includes), `${fn}: "${error.message}" não contém "${includes}"`);
  return error.message;
}

/** Espera recusa por falta de permissão/sessão (RPC ou PostgREST). */
export async function expectDenied(sb: SupabaseClient, fn: string, args: Record<string, unknown> = {}) {
  const { data, error } = await tryRpc(sb, fn, args);
  assert(error, `${fn} deveria ser recusada, mas devolveu ${JSON.stringify(data)?.slice(0, 200)}`);
  return error.message;
}

export async function waitForTaskStatus(sb: SupabaseClient, taskId: string, notStatus: string, tries = 60) {
  let detail = await rpc(sb, 'get_task', { p_id: taskId });
  for (let i = 0; i < tries && detail.status === notStatus; i++) {
    await new Promise((r) => setTimeout(r, 500));
    detail = await rpc(sb, 'get_task', { p_id: taskId });
  }
  return detail;
}

/** Decodifica o payload de um JWT (sem validar). */
export function jwtPayload(token: string): Record<string, unknown> {
  const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(atob(part.padEnd(part.length + ((4 - (part.length % 4)) % 4), '=')));
}

export const b64url = (value: unknown) =>
  btoa(typeof value === 'string' ? value : JSON.stringify(value)).replace(/=+$/, '').replace(/\+/g, '-').replace(
    /\//g,
    '_',
  );

export { assert, assertEquals };
