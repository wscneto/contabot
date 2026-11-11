/**
 * Teste de ponta a ponta contra o Supabase local (banco + storage + Edge Functions).
 *
 * Pré-requisitos:
 *   pnpm dlx supabase start
 *   pnpm dlx supabase functions serve --env-file supabase/functions/.env   (VISION_PROVIDER=mock)
 *
 * Execução:
 *   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     deno test -A supabase/tests/integration.test.ts
 *
 * Cria lojas descartáveis com e-mails aleatórios; não depende do seed de demonstração.
 */
import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { computeFingerprint } from '../functions/_shared/frame-selection.ts';

const URL_ = Deno.env.get('SUPABASE_URL') ?? 'http://127.0.0.1:54321';
const ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const image = await Deno.readFile(new URL('../seed/images/product-choco.jpg', import.meta.url));

const client = () => createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

// deno-lint-ignore no-explicit-any
async function rpc(sb: SupabaseClient, fn: string, args: Record<string, unknown> = {}): Promise<any> {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data;
}

async function newManager(storeName: string) {
  const sb = client();
  const email = `gerente-${crypto.randomUUID().slice(0, 8)}@teste.contabot.app`;
  const { data, error } = await sb.auth.signUp({
    email,
    password: 'senha-forte-123',
    options: { data: { name: 'Gerente Teste', store_name: storeName } },
  });
  if (error || !data.session) throw new Error(`signUp: ${error?.message ?? 'sem sessão (confirmação de e-mail ligada?)'}`);
  return sb;
}

async function invoke(sb: SupabaseClient, name: string, body: Record<string, unknown>) {
  const { data, error } = await sb.functions.invoke(name, { body });
  if (error) {
    const detail = await error.context?.json?.().catch(() => null);
    throw new Error(`${name}: ${detail?.detail ?? error.message}`);
  }
  return data;
}

function fakeFingerprint(seed: number) {
  const size = 32;
  const data = new Uint8Array(size * size * 4).map((_, i) => (i * seed * 7) % 256);
  return computeFingerprint({ data, width: size, height: size });
}

Deno.test({
  name: 'fluxo completo: cadastro, catálogo, captura analisada (mock), envio e aprovação',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const manager = await newManager('Loja Integração');
    const me = await rpc(manager, 'whoami');
    assertEquals(me.user.role, 'manager');
    const storeId: string = me.store.id;

    // Produto com foto no storage (somente gerente pode enviar para products/).
    const photoPath = `${storeId}/products/${crypto.randomUUID()}.jpg`;
    const up = await manager.storage.from('media').upload(photoPath, image, { contentType: 'image/jpeg' });
    assert(!up.error, up.error?.message);
    const product = await rpc(manager, 'create_product', {
      p_name: 'Chocolate',
      p_variant: '90 g',
      p_photos: [photoPath],
      p_min_stock: 5,
    });
    const product2 = await rpc(manager, 'create_product', { p_name: 'Biscoito', p_photos: [photoPath] });
    await assertRejects(() => rpc(manager, 'create_product', { p_name: 'Sem foto', p_photos: [] }), Error, '1 a 4 fotos');
    await assertRejects(
      () => rpc(manager, 'create_product', { p_name: 'X', p_photos: [`${storeId}/products/nao-existe.jpg`] }),
      Error,
      'não enviada',
    );

    const area = await rpc(manager, 'create_area', {
      p_name: 'Gôndola 1',
      p_product_ids: [product.id, product2.id],
    });
    assertEquals(area.product_count, 2);

    // Funcionário: cadastro pela Edge Function e login por código.
    const created = await invoke(manager, 'create-employee', { name: 'Ana Teste' });
    assertEquals(created.user.role, 'employee');
    assert(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(created.access_code));

    const employee = client();
    const joined = await invoke(employee, 'join-store', { code: created.access_code.toLowerCase() });
    const otp = await employee.auth.verifyOtp({ token_hash: joined.token_hash, type: 'magiclink' });
    assert(!otp.error && otp.data.session, otp.error?.message);
    const empMe = await rpc(employee, 'whoami');
    assertEquals(empMe.user.name, 'Ana Teste');
    assertEquals(empMe.store.id, storeId);
    await assertRejects(() => invoke(client(), 'join-store', { code: 'AAAA-BBBB' }), Error, 'não encontrado');

    // Permissões: funcionário não acessa rotas do gerente nem envia fotos de produto.
    await assertRejects(() => rpc(employee, 'get_dashboard'), Error, 'gerente');
    await assertRejects(() => rpc(employee, 'list_team'), Error, 'gerente');
    const forbidden = await employee.storage.from('media').upload(`${storeId}/products/x.jpg`, image, {
      contentType: 'image/jpeg',
    });
    assert(forbidden.error, 'funcionário não pode enviar foto de produto');
    const direct = await employee.from('tasks').insert({ store_id: storeId, area_id: area.id, status: 'open' });
    assert(direct.error, 'escrita direta em tabela é bloqueada');

    // Contagem atribuída ao funcionário.
    const [task] = await rpc(manager, 'create_tasks', {
      p_area_ids: [area.id],
      p_assignee_id: empMe.user.id,
      p_due_date: '2000-01-01',
      p_note: 'Teste',
    });
    assertEquals(task.status, 'open');
    assertEquals(task.overdue, true);
    const again = await rpc(manager, 'create_tasks', { p_area_ids: [area.id] });
    assertEquals(again[0].id, task.id, 'reaproveita a contagem aberta da área');
    const mine = await rpc(employee, 'list_tasks', { p_scope: 'mine' });
    assertEquals(mine.map((t: { id: string }) => t.id), [task.id]);

    // Captura: o celular cria, envia os quadros e dispara a análise.
    const start = await rpc(employee, 'start_capture', { p_task_id: task.id });
    const frames: Record<string, unknown>[] = [];
    for (let i = 0; i < 3; i++) {
      const id = `f000${i + 1}`;
      const path = `${start.upload_prefix}${id}.jpg`;
      const r = await employee.storage.from('media').upload(path, image, { contentType: 'image/jpeg' });
      assert(!r.error, r.error?.message);
      frames.push({
        id,
        path,
        timestamp_seconds: i * 2,
        metrics: { sharpness: 100, exposure: 0.8, motion: 0, glare: 0, quality: 0.7 },
        warnings: [],
        fingerprint: fakeFingerprint(i + 1),
      });
    }
    await assertRejects(
      () =>
        rpc(employee, 'register_capture_frames', {
          p_capture_id: start.capture_id,
          p_frames: [{ ...frames[0], path: `${storeId}/products/x.jpg` }],
          p_selected_frame_ids: ['f0001'],
          p_primary_frame_id: 'f0001',
        }),
      Error,
      'Quadro inválido',
    );
    await rpc(employee, 'register_capture_frames', {
      p_capture_id: start.capture_id,
      p_frames: frames,
      p_selected_frame_ids: ['f0001', 'f0003'],
      p_primary_frame_id: 'f0001',
      p_selection: { version: 'teste' },
    });
    await invoke(employee, 'analyze-capture', { capture_id: start.capture_id });

    let detail = await rpc(employee, 'get_task', { p_id: task.id });
    for (let i = 0; i < 60 && detail.status === 'analyzing'; i++) {
      await new Promise((r) => setTimeout(r, 500));
      detail = await rpc(employee, 'get_task', { p_id: task.id });
    }
    assertEquals(detail.status, 'review', `captura: ${JSON.stringify(detail.capture)}`);
    assertEquals(detail.capture.status, 'done');
    assertEquals(detail.capture.simulated, true);
    assert(detail.capture.frames.length >= 2);
    const items = detail.items as { product_id: string; ai_status: string; ai_quantity: number | null }[];
    assert(items.every((i) => i.ai_status !== 'manual'), JSON.stringify(items));

    // Conferência e envio.
    const counts = Object.fromEntries(items.map((i) => [i.product_id, i.ai_quantity ?? 0]));
    await assertRejects(
      () => rpc(employee, 'submit_task', { p_id: task.id, p_counts: { [product.id]: 1 } }),
      Error,
      'exatamente',
    );
    await assertRejects(
      () => rpc(employee, 'submit_task', { p_id: task.id, p_counts: { ...counts, [product.id]: -1 } }),
      Error,
      'não negativos',
    );
    const submitted = await rpc(employee, 'submit_task', { p_id: task.id, p_counts: counts });
    assertEquals(submitted.status, 'submitted');

    const dashboard = await rpc(manager, 'get_dashboard');
    assertEquals(dashboard.counts.to_approve, 1);

    // Recontagem e nova rodada manual.
    const recount = await rpc(manager, 'request_recount', { p_id: task.id, p_note: 'Conferir o fundo.' });
    assertEquals(recount.status, 'open');
    assertEquals(recount.recount_requested, true);
    const manual = await rpc(employee, 'switch_to_manual', { p_id: task.id });
    assertEquals(manual.status, 'review');
    await rpc(employee, 'submit_task', { p_id: task.id, p_counts: { [product.id]: 2, [product2.id]: null } });

    // Aprovação com ajuste do gerente atualiza o estoque.
    const approved = await rpc(manager, 'approve_task', { p_id: task.id, p_counts: { [product.id]: 3 } });
    assertEquals(approved.status, 'approved');
    const prod = await rpc(manager, 'get_product', { p_id: product.id });
    assertEquals(prod.stock, 3);
    assertEquals(prod.low_stock, true);
    assertEquals(prod.history.length, 1);
    await assertRejects(() => rpc(manager, 'delete_task', { p_id: task.id }), Error, 'aprovadas');

    // Outra loja não enxerga nada desta.
    const outsider = await newManager('Outra Loja');
    assertEquals(await rpc(outsider, 'list_products'), []);
    await assertRejects(() => rpc(outsider, 'get_task', { p_id: task.id }), Error, 'não encontrada');
    const peek = await outsider.from('tasks').select('id').eq('id', task.id);
    assertEquals(peek.data, []);
    const stolen = await outsider.storage.from('media').download(photoPath);
    assert(stolen.error, 'storage de outra loja é inacessível');
    await assertRejects(() => invoke(outsider, 'analyze-capture', { capture_id: start.capture_id }), Error, 'não encontrada');

    // Novo código invalida o antigo; desativação bloqueia o acesso.
    const regenerated = await rpc(manager, 'regenerate_access_code', { p_user_id: empMe.user.id });
    assert(regenerated.access_code !== created.access_code);
    await assertRejects(() => invoke(client(), 'join-store', { code: created.access_code }), Error, 'não encontrado');
    await rpc(manager, 'deactivate_member', { p_user_id: empMe.user.id });
    await assertRejects(() => rpc(employee, 'whoami'), Error, 'desativado');
    await assertRejects(() => invoke(client(), 'join-store', { code: regenerated.access_code }), Error, 'não encontrado');
    const team = await rpc(manager, 'list_team');
    assertEquals(team.find((u: { id: string }) => u.id === empMe.user.id).active, false);
  },
});

Deno.test({
  name: 'falha no celular nunca deixa a contagem presa em análise',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const manager = await newManager('Loja Falha');
    const { store } = await rpc(manager, 'whoami');
    const photoPath = `${store.id}/products/${crypto.randomUUID()}.jpg`;
    await manager.storage.from('media').upload(photoPath, image, { contentType: 'image/jpeg' });
    const product = await rpc(manager, 'create_product', { p_name: 'Café', p_photos: [photoPath] });
    const area = await rpc(manager, 'create_area', { p_name: 'Área', p_product_ids: [product.id] });
    const [task] = await rpc(manager, 'create_tasks', { p_area_ids: [area.id] });

    const start = await rpc(manager, 'start_capture', { p_task_id: task.id });
    const failed = await rpc(manager, 'fail_capture', { p_capture_id: start.capture_id, p_error: 'Vídeo ilegível.' });
    assertEquals(failed.status, 'review');
    assertEquals(failed.capture.status, 'failed');
    assertEquals(failed.items[0].ai_status, 'manual');

    // App fechado no meio da seleção: "contagem manual" cancela a captura pendente.
    const second = await rpc(manager, 'start_capture', { p_task_id: task.id });
    const manual = await rpc(manager, 'switch_to_manual', { p_id: task.id });
    assertEquals(manual.status, 'review');
    const { data: cap } = await admin.from('captures').select('status').eq('id', second.capture_id).single();
    assertEquals(cap?.status, 'failed');

    // Funções do pipeline são exclusivas do service role.
    await assertRejects(
      () => rpc(manager, 'pipeline_fail', { p_capture_id: second.capture_id, p_error: 'x' }),
      Error,
    );
  },
});

Deno.test({
  name: 'capturas paradas expiram e o limite diário de análises é respeitado',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const manager = await newManager('Loja Expiração');
    const { store } = await rpc(manager, 'whoami');
    const photoPath = `${store.id}/products/${crypto.randomUUID()}.jpg`;
    await manager.storage.from('media').upload(photoPath, image, { contentType: 'image/jpeg' });
    const product = await rpc(manager, 'create_product', { p_name: 'Arroz', p_photos: [photoPath] });
    const area = await rpc(manager, 'create_area', { p_name: 'Corredor', p_product_ids: [product.id] });
    const [task] = await rpc(manager, 'create_tasks', { p_area_ids: [area.id] });
    const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

    // App fechado durante o envio: a captura em "frames" expira depois de 15 minutos.
    const first = await rpc(manager, 'start_capture', { p_task_id: task.id });
    await admin.from('captures').update({ updated_at: ago(5) }).eq('id', first.capture_id);
    assertEquals((await rpc(manager, 'get_task', { p_id: task.id })).status, 'analyzing', 'ainda dentro do prazo');
    await admin.from('captures').update({ updated_at: ago(16) }).eq('id', first.capture_id);
    let detail = await rpc(manager, 'get_task', { p_id: task.id });
    assertEquals(detail.status, 'review');
    assertEquals(detail.capture.status, 'failed');
    assert(String(detail.capture.error).includes('envio dos quadros'), detail.capture.error);
    assertEquals(detail.items[0].ai_status, 'manual');

    // Edge Function interrompida depois de assumir a contagem: expira em 10 minutos,
    // e a resposta tardia do modelo não sobrescreve a falha.
    const second = await rpc(manager, 'start_capture', { p_task_id: task.id });
    await admin.from('captures')
      .update({ stage: 'counting', claimed_stage: 'counting', updated_at: ago(11) })
      .eq('id', second.capture_id);
    const listed = await rpc(manager, 'list_tasks', { p_scope: 'all' });
    assertEquals(listed.find((t: { id: string }) => t.id === task.id).status, 'review');
    detail = await rpc(manager, 'get_task', { p_id: task.id });
    assertEquals(detail.capture.status, 'failed');
    assert(String(detail.capture.error).includes('demorou demais'), detail.capture.error);
    const late = await admin.rpc('pipeline_finish', {
      p_capture_id: second.capture_id,
      p_result_frames: [],
      p_unknown_products: [],
      p_items: [],
      p_event: 'resposta tardia',
    });
    assertEquals(late.data, false);

    // Limite diário: as duas capturas acima já contam.
    await admin.from('stores').update({ daily_capture_limit: 3 }).eq('id', store.id);
    const third = await rpc(manager, 'start_capture', { p_task_id: task.id });
    await rpc(manager, 'fail_capture', { p_capture_id: third.capture_id, p_error: 'teste' });
    await assertRejects(() => rpc(manager, 'start_capture', { p_task_id: task.id }), Error, 'Limite de 3 análises');
    const blocked = await rpc(manager, 'get_task', { p_id: task.id });
    assertEquals(blocked.status, 'review', 'limite não deixa a contagem presa');
  },
});
