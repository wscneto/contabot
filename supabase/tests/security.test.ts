/**
 * Testes de segurança (pentest automatizado) contra o Supabase local.
 *
 * Organizados pelo OWASP API Security Top 10 (2023). Cada caso simula um
 * atacante real usando só o que um cliente tem: a URL pública, a chave anon
 * e (quando autenticado) a própria sessão. O service role aparece apenas para
 * conferir que o estado da vítima não mudou.
 *
 * Execução (mesmos pré-requisitos do teste de integração):
 *   SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     deno test -A supabase/tests/security.test.ts
 */
import {
  admin,
  ANON_KEY,
  assert,
  assertEquals,
  assertNoInternalLeak,
  b64url,
  callFunction,
  client,
  countsFor,
  expectDenied,
  expectFriendlyError,
  image,
  jwtPayload,
  newEmployee,
  newManager,
  net,
  populateStore,
  rpc,
  SUPABASE_URL,
  withToken,
} from './_helpers.ts';

// ---------------------------------------------------------------------------
// Cenário: loja A (vítima) com dois funcionários e loja B (atacante).
// ---------------------------------------------------------------------------
const A = await newManager('Loja A (vítima)');
const ana = await newEmployee(A, 'Ana A');
const bruno = await newEmployee(A, 'Bruno A');
const storeA = await populateStore(A, ana.id); // contagem atribuída à Ana
const B = await newManager('Loja B (atacante)');
const eva = await newEmployee(B, 'Eva B');
const storeB = await populateStore(B);

// Uma segunda contagem da loja A, com captura iniciada pela Ana (fica em "frames").
const areaA2 = await rpc(A.sb, 'create_area', { p_name: 'Corredor A2', p_product_ids: [storeA.products[0].id] });
const [taskA2] = await rpc(A.sb, 'create_tasks', { p_area_ids: [areaA2.id], p_assignee_id: ana.id });
const captureA = await rpc(ana.sb, 'start_capture', { p_task_id: taskA2.id });

const TABLES = [
  'stores',
  'profiles',
  'access_codes',
  'products',
  'areas',
  'area_products',
  'tasks',
  'task_items',
  'task_events',
  'captures',
  'stock_entries',
];

const uuid = () => crypto.randomUUID();

/** Todas as RPCs expostas ao app, com argumentos plausíveis. */
const ALL_RPCS: [string, Record<string, unknown>][] = [
  ['whoami', {}],
  ['list_team', {}],
  ['regenerate_access_code', { p_user_id: uuid() }],
  ['deactivate_member', { p_user_id: uuid() }],
  ['list_products', {}],
  ['get_product', { p_id: uuid() }],
  ['create_product', { p_name: 'x', p_photos: ['x'] }],
  ['update_product', { p_id: uuid(), p_name: 'x' }],
  ['archive_product', { p_id: uuid() }],
  ['import_products', { p_items: [{ name: 'x' }] }],
  ['list_areas', {}],
  ['get_area', { p_id: uuid() }],
  ['create_area', { p_name: 'x', p_product_ids: [] }],
  ['update_area', { p_id: uuid(), p_name: 'x' }],
  ['delete_area', { p_id: uuid() }],
  ['list_tasks', { p_scope: 'all' }],
  ['get_task', { p_id: uuid() }],
  ['create_tasks', { p_area_ids: [uuid()] }],
  ['update_task', { p_id: uuid(), p_patch: {} }],
  ['delete_task', { p_id: uuid() }],
  ['switch_to_manual', { p_id: uuid() }],
  ['submit_task', { p_id: uuid(), p_counts: {} }],
  ['approve_task', { p_id: uuid() }],
  ['request_recount', { p_id: uuid(), p_note: 'x' }],
  ['start_capture', { p_task_id: uuid() }],
  ['register_capture_frames', { p_capture_id: uuid(), p_frames: [], p_selected_frame_ids: [], p_primary_frame_id: 'f0001' }],
  ['fail_capture', { p_capture_id: uuid(), p_error: 'x' }],
  ['get_dashboard', {}],
  ['get_store_settings', {}],
  ['update_counting_instruction', { p_instruction: 'x' }],
  ['my_store_id', {}],
  ['is_manager', {}],
];

const MANAGER_ONLY = new Set([
  'list_team',
  'regenerate_access_code',
  'deactivate_member',
  'create_product',
  'update_product',
  'archive_product',
  'import_products',
  'create_area',
  'update_area',
  'delete_area',
  'update_task',
  'delete_task',
  'approve_task',
  'request_recount',
  'get_dashboard',
  'update_counting_instruction',
]);

const PIPELINE_RPCS: [string, Record<string, unknown>][] = [
  ['pipeline_claim', { p_capture_id: captureA.capture_id, p_stage: 'frames' }],
  ['pipeline_set_stage', { p_capture_id: captureA.capture_id, p_stage: 'counting' }],
  ['pipeline_fail', { p_capture_id: captureA.capture_id, p_error: 'invasão' }],
  [
    'pipeline_finish',
    { p_capture_id: captureA.capture_id, p_result_frames: [], p_unknown_products: [], p_items: [], p_event: 'x' },
  ],
];

async function captureStatus(id: string) {
  const { data } = await admin.from('captures').select('status, stage').eq('id', id).single();
  return data;
}

// ===========================================================================
// API1 — Broken Object Level Authorization (IDOR)
// ===========================================================================
Deno.test({
  name: 'API1 · BOLA: gerente de outra loja não lê nem altera objetos da loja A',
  ...net,
  async fn(t) {
    const [prod] = storeA.products;
    const attempts: [string, Record<string, unknown>][] = [
      ['get_product', { p_id: prod.id }],
      ['update_product', { p_id: prod.id, p_name: 'hackeado' }],
      ['archive_product', { p_id: prod.id }],
      ['get_area', { p_id: storeA.area.id }],
      ['update_area', { p_id: storeA.area.id, p_name: 'hackeada' }],
      ['delete_area', { p_id: storeA.area.id }],
      ['get_task', { p_id: storeA.task.id }],
      ['update_task', { p_id: storeA.task.id, p_patch: { note: 'hack' } }],
      ['delete_task', { p_id: storeA.task.id }],
      ['switch_to_manual', { p_id: storeA.task.id }],
      ['submit_task', { p_id: storeA.task.id, p_counts: countsFor(storeA.products) }],
      ['approve_task', { p_id: storeA.task.id }],
      ['request_recount', { p_id: storeA.task.id, p_note: 'hack' }],
      ['start_capture', { p_task_id: storeA.task.id }],
      ['fail_capture', { p_capture_id: captureA.capture_id, p_error: 'hack' }],
      [
        'register_capture_frames',
        { p_capture_id: captureA.capture_id, p_frames: [], p_selected_frame_ids: [], p_primary_frame_id: 'f0001' },
      ],
      ['regenerate_access_code', { p_user_id: ana.id }],
      ['deactivate_member', { p_user_id: ana.id }],
      ['create_area', { p_name: 'Roubo', p_product_ids: [prod.id] }],
      ['create_product', { p_name: 'Roubo', p_photos: [storeA.photo] }],
      ['update_task', { p_id: storeB.task.id, p_patch: { assignee_id: ana.id } }],
      ['create_tasks', { p_area_ids: [storeB.area.id], p_assignee_id: ana.id }],
    ];
    for (const [fn, args] of attempts) {
      await t.step(`${fn} com objeto da loja A é recusada`, async () => {
        await expectFriendlyError(B.sb, fn, args);
      });
    }

    await t.step('create_tasks com área de outra loja não cria nada', async () => {
      assertEquals(await rpc(B.sb, 'create_tasks', { p_area_ids: [storeA.area.id] }), []);
      const { count } = await admin.from('tasks').select('id', { count: 'exact', head: true }).eq('area_id', storeA.area.id);
      assertEquals(count, 1);
    });

    await t.step('estado da loja A permanece intacto', async () => {
      const product = await rpc(A.sb, 'get_product', { p_id: prod.id });
      assertEquals(product.name, 'Chocolate');
      const area = await rpc(A.sb, 'get_area', { p_id: storeA.area.id });
      assert(area.name.startsWith('Gôndola'));
      const task = await rpc(A.sb, 'get_task', { p_id: storeA.task.id });
      assertEquals(task.status, 'open');
      assertEquals(task.note, '');
      assertEquals((await captureStatus(captureA.capture_id))?.status, 'processing');
      const me = await rpc(ana.sb, 'whoami');
      assertEquals(me.user.active, true);
    });

    await t.step('leitura direta das tabelas não enxerga a loja A', async () => {
      for (const table of TABLES.filter((x) => x !== 'access_codes')) {
        const { data, error } = await B.sb.from(table).select('*');
        if (error) continue; // coluna/tabela sem permissão também é recusa
        const leaked = (data ?? []).filter((row: Record<string, unknown>) =>
          [row.store_id, row.id].includes(A.storeId) || JSON.stringify(row).includes(A.storeId)
        );
        assertEquals(leaked, [], `tabela ${table} vazou dados da loja A`);
      }
    });

    await t.step('funcionário de outra loja também não acessa', async () => {
      await expectFriendlyError(eva.sb, 'get_task', { p_id: storeA.task.id }, 'não encontrada');
      await expectFriendlyError(eva.sb, 'start_capture', { p_task_id: storeA.task.id }, 'não encontrada');
      await expectFriendlyError(eva.sb, 'submit_task', { p_id: storeA.task.id, p_counts: {} }, 'não encontrada');
    });

    await t.step('Edge Function analyze-capture não processa captura de outra loja', async () => {
      const r = await callFunction('analyze-capture', { capture_id: captureA.capture_id }, {
        Authorization: `Bearer ${B.accessToken}`,
      });
      assertEquals(r.status, 404);
    });
  },
});

Deno.test({
  name: 'API1 · BOLA no Storage: mídia é isolada por pasta de loja',
  ...net,
  async fn(t) {
    await t.step('download, URL assinada e listagem de outra loja falham', async () => {
      assert((await B.sb.storage.from('media').download(storeA.photo)).error);
      assert((await B.sb.storage.from('media').createSignedUrl(storeA.photo, 60)).error);
      const listed = await B.sb.storage.from('media').list(`${A.storeId}/products`);
      assertEquals(listed.data ?? [], []);
    });

    await t.step('upload na pasta de outra loja é bloqueado (inclusive com ../)', async () => {
      const paths = [
        `${A.storeId}/captures/${uuid()}/f0001.jpg`,
        `${A.storeId}/products/${uuid()}.jpg`,
        `${B.storeId}/captures/../../${A.storeId}/products/x.jpg`,
        `${B.storeId}/../${A.storeId}/captures/x.jpg`,
      ];
      for (const path of paths) {
        const { error } = await B.sb.storage.from('media').upload(path, image, { contentType: 'image/jpeg' });
        assert(error, `upload em ${path} deveria falhar`);
      }
    });

    await t.step('URL pública do bucket privado não funciona', async () => {
      const r = await fetch(`${SUPABASE_URL}/storage/v1/object/public/media/${storeA.photo}`);
      await r.body?.cancel();
      assert(r.status >= 400, `status ${r.status}`);
    });

    await t.step('ninguém sobrescreve nem apaga mídia existente', async () => {
      const over = await A.sb.storage.from('media').upload(storeA.photo, image, {
        contentType: 'image/jpeg',
        upsert: true,
      });
      assert(over.error, 'upsert deveria ser recusado');
      await A.sb.storage.from('media').remove([storeA.photo]);
      assert(!(await A.sb.storage.from('media').download(storeA.photo)).error, 'foto continua existindo');
    });
  },
});

Deno.test({
  name: 'API1 · BOLA entre funcionários: só o responsável age sobre a contagem atribuída',
  ...net,
  async fn(t) {
    const [task] = await rpc(A.sb, 'create_tasks', {
      p_area_ids: [(await rpc(A.sb, 'create_area', { p_name: 'Atribuída', p_product_ids: [storeA.products[1].id] })).id],
      p_assignee_id: ana.id,
    });

    await t.step('Bruno não inicia captura, não muda para manual e não envia a contagem da Ana', async () => {
      await expectFriendlyError(bruno.sb, 'start_capture', { p_task_id: task.id }, 'outro funcionário');
      await expectFriendlyError(bruno.sb, 'switch_to_manual', { p_id: task.id }, 'outro funcionário');
      await rpc(ana.sb, 'switch_to_manual', { p_id: task.id });
      await expectFriendlyError(
        bruno.sb,
        'submit_task',
        { p_id: task.id, p_counts: { [storeA.products[1].id]: 5 } },
        'outro funcionário',
      );
    });

    await t.step('Bruno não cancela a captura da Ana', async () => {
      await expectFriendlyError(bruno.sb, 'fail_capture', { p_capture_id: captureA.capture_id, p_error: 'x' });
      assertEquals((await captureStatus(captureA.capture_id))?.status, 'processing');
    });

    await t.step('controle positivo: a Ana e o gerente conseguem', async () => {
      const submitted = await rpc(ana.sb, 'submit_task', { p_id: task.id, p_counts: { [storeA.products[1].id]: 5 } });
      assertEquals(submitted.status, 'submitted');
      assertEquals(submitted.submitted_by.id, ana.id);
      const approved = await rpc(A.sb, 'approve_task', { p_id: task.id });
      assertEquals(approved.status, 'approved');
    });

    await t.step('contagem sem responsável continua disponível para qualquer funcionário', async () => {
      const area = await rpc(A.sb, 'create_area', { p_name: 'Livre', p_product_ids: [storeA.products[1].id] });
      const [free] = await rpc(A.sb, 'create_tasks', { p_area_ids: [area.id] });
      const manual = await rpc(bruno.sb, 'switch_to_manual', { p_id: free.id });
      assertEquals(manual.assignee.id, bruno.id, 'quem assume vira o responsável');
    });
  },
});

// ===========================================================================
// API2 — Broken Authentication
// ===========================================================================
Deno.test({
  name: 'API2 · Autenticação: anônimo não executa nenhuma RPC nem lê dados',
  ...net,
  async fn(t) {
    const anon = client();
    for (const [fn, args] of [...ALL_RPCS, ...PIPELINE_RPCS]) {
      await t.step(`anon → ${fn} recusada na camada de GRANT`, async () => {
        const message = await expectDenied(anon, fn, args);
        assert(/permission denied/i.test(message), `${fn}: esperado "permission denied", veio "${message}"`);
      });
    }
    await t.step('anon não lê nenhuma linha de nenhuma tabela', async () => {
      for (const table of TABLES) {
        const { data, error } = await anon.from(table).select('*').limit(5);
        assert(error || data?.length === 0, `anon leu ${table}: ${JSON.stringify(data)}`);
      }
    });
    await t.step('anon não lista nem baixa mídia', async () => {
      assertEquals((await anon.storage.from('media').list(A.storeId)).data ?? [], []);
      assert((await anon.storage.from('media').download(storeA.photo)).error);
    });
  },
});

Deno.test({
  name: 'API2 · Autenticação: tokens forjados, adulterados ou inválidos são rejeitados',
  ...net,
  async fn(t) {
    const payload = jwtPayload(A.accessToken);
    const [header, , signature] = A.accessToken.split('.');

    await t.step('alg "none" (sem assinatura)', async () => {
      const token = `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url(payload)}.`;
      await expectDenied(withToken(token), 'whoami');
    });

    await t.step('payload adulterado (sub de outro usuário) com a assinatura original', async () => {
      const token = `${header}.${b64url({ ...payload, sub: ana.id })}.${signature}`;
      await expectDenied(withToken(token), 'whoami');
    });

    await t.step('escalada para service_role com assinatura inválida', async () => {
      const token = `${header}.${b64url({ ...payload, role: 'service_role' })}.${signature}`;
      await expectDenied(withToken(token), 'pipeline_fail', { p_capture_id: captureA.capture_id, p_error: 'x' });
      assertEquals((await captureStatus(captureA.capture_id))?.status, 'processing');
    });

    await t.step('exp alterado para o futuro distante com a assinatura original', async () => {
      const token = `${header}.${b64url({ ...payload, exp: 4_102_444_800 })}.${signature}`;
      await expectDenied(withToken(token), 'whoami');
    });

    await t.step('confusão de algoritmo: HS256 assinado com a chave pública do JWKS', async () => {
      const jwks = await (await fetch(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`)).json();
      const forgedHeader = b64url({ alg: 'HS256', typ: 'JWT', kid: jwks.keys?.[0]?.kid });
      const body = b64url({ ...payload, role: 'service_role' });
      const secrets = [JSON.stringify(jwks.keys?.[0] ?? {}), String(jwks.keys?.[0]?.x ?? ''), ANON_KEY];
      for (const secret of secrets) {
        const key = await crypto.subtle.importKey(
          'raw',
          new TextEncoder().encode(secret),
          { name: 'HMAC', hash: 'SHA-256' },
          false,
          ['sign'],
        );
        const sig = new Uint8Array(
          await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${forgedHeader}.${body}`)),
        );
        const token = `${forgedHeader}.${body}.${b64url(String.fromCharCode(...sig))}`;
        await expectDenied(withToken(token), 'whoami');
        await expectDenied(withToken(token), 'pipeline_fail', { p_capture_id: captureA.capture_id, p_error: 'x' });
      }
    });

    await t.step('lixo no Authorization', async () => {
      await expectDenied(withToken('nao-e-um-jwt'), 'whoami');
      await expectDenied(withToken(ANON_KEY + 'x'), 'whoami');
    });

    await t.step('Edge Functions exigem sessão válida', async () => {
      assertEquals((await callFunction('create-employee', { name: 'x' })).status, 401);
      assertEquals(
        (await callFunction('create-employee', { name: 'x' }, { Authorization: 'Bearer lixo' })).status,
        401,
      );
      assertEquals((await callFunction('analyze-capture', { capture_id: captureA.capture_id })).status, 404);
    });
  },
});

Deno.test({
  name: 'API2 · Login por código: entradas hostis, hash e revogação de sessão',
  ...net,
  async fn(t) {
    await t.step('códigos malformados recebem 4xx com mensagem amigável (nunca 500)', async () => {
      const bodies: unknown[] = [
        {},
        { code: '' },
        { code: 'ABC' },
        { code: 'A'.repeat(10_000) },
        { code: "' OR '1'='1" },
        { code: 'AAAA-BBBB' },
        { code: 12345678 },
        { code: [ana.code] }, // código válido embrulhado em array (confusão de tipos)
        { code: { toString: ana.code } },
        { code: { $ne: null } },
        { code: null },
        '{"code": ',
        '[]',
      ];
      for (const body of bodies) {
        const r = await callFunction('join-store', body);
        assert(r.status >= 400 && r.status < 500, `join-store(${JSON.stringify(body)}) → ${r.status}`);
        assert(typeof r.body?.detail === 'string', JSON.stringify(r.body));
        assert(!('token_hash' in (r.body ?? {})));
      }
    });

    await t.step('o banco guarda só o SHA-256 do código, inacessível aos membros', async () => {
      const emp = await newEmployee(A, 'Carlos A');
      const { data } = await admin.from('access_codes').select('code_hash').eq('user_id', emp.id).single();
      const normalized = emp.code.replace('-', '');
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
      const expected = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
      assertEquals(data?.code_hash, expected);
      assert(!data?.code_hash.includes(normalized));
      for (const sb of [A.sb, emp.sb]) {
        const { data: rows, error } = await sb.from('access_codes').select('*');
        assert(error || rows?.length === 0, 'access_codes não pode ser lida por membros');
      }
    });

    await t.step('códigos têm formato e alfabeto sem caracteres ambíguos e não se repetem', async () => {
      const emp = await newEmployee(A, 'Dora A');
      const seen = new Set<string>();
      for (let i = 0; i < 15; i++) {
        const { access_code } = await rpc(A.sb, 'regenerate_access_code', { p_user_id: emp.id });
        assert(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(access_code), access_code);
        seen.add(access_code);
      }
      assertEquals(seen.size, 15);
    });

    await t.step('novo código invalida o anterior e encerra as sessões (refresh token)', async () => {
      const emp = await newEmployee(A, 'Edu A');
      await rpc(A.sb, 'regenerate_access_code', { p_user_id: emp.id });
      const r = await callFunction('join-store', { code: emp.code });
      assertEquals(r.status, 401);
      const refreshed = await client().auth.refreshSession({ refresh_token: emp.refreshToken });
      assert(refreshed.error, 'refresh token antigo deveria estar revogado');
    });

    await t.step('funcionário desativado perde acesso mesmo com o access token ainda válido', async () => {
      const emp = await newEmployee(A, 'Fabi A');
      await rpc(A.sb, 'deactivate_member', { p_user_id: emp.id });
      await expectFriendlyError(emp.sb, 'whoami', {}, 'desativado');
      await expectFriendlyError(emp.sb, 'list_tasks', { p_scope: 'mine' }, 'desativado');
      for (const table of ['tasks', 'products', 'profiles']) {
        const { data } = await emp.sb.from(table).select('id');
        assertEquals(data ?? [], [], `desativado ainda lê ${table}`);
      }
      assert((await emp.sb.storage.from('media').download(storeA.photo)).error, 'desativado ainda baixa mídia');
      const up = await emp.sb.storage.from('media').upload(`${A.storeId}/captures/${uuid()}/f0001.jpg`, image, {
        contentType: 'image/jpeg',
      });
      assert(up.error, 'desativado ainda envia mídia');
      assert((await client().auth.refreshSession({ refresh_token: emp.refreshToken })).error);
      assertEquals((await callFunction('join-store', { code: emp.code })).status, 401);
    });

    await t.step('gerente não pode se desativar', async () => {
      await expectFriendlyError(A.sb, 'deactivate_member', { p_user_id: A.id }, 'próprio');
    });
  },
});

// ===========================================================================
// API3 — Broken Object Property Level Authorization (mass assignment / exposição)
// ===========================================================================
Deno.test({
  name: 'API3 · Mass assignment e exposição excessiva de dados',
  ...net,
  async fn(t) {
    await t.step('metadados do cadastro não escolhem papel nem loja', async () => {
      const intruder = await newManager('Intrusa', { role: 'employee', store_id: A.storeId, active: false });
      assert(intruder.storeId !== A.storeId);
      const me = await rpc(intruder.sb, 'whoami');
      assertEquals(me.user.role, 'manager');
      assertEquals(me.user.active, true);
    });

    await t.step('cadastro sem loja não ganha perfil', async () => {
      const sb = client();
      const { data } = await sb.auth.signUp({
        email: `sem-loja-${uuid().slice(0, 8)}@teste.contabot.app`,
        password: 'senha-forte-123',
        options: { data: { name: 'Sem Loja', role: 'manager', store_id: A.storeId } },
      });
      assert(data.session);
      await expectFriendlyError(sb, 'whoami', {}, 'Sessão inválida');
      assertEquals((await sb.from('products').select('id')).data ?? [], []);
    });

    await t.step('updateUser com metadados não altera papel', async () => {
      await ana.sb.auth.updateUser({ data: { role: 'manager', store_name: 'Golpe', store_id: B.storeId } });
      const me = await rpc(ana.sb, 'whoami');
      assertEquals(me.user.role, 'employee');
      assertEquals(me.store.id, A.storeId);
      await expectFriendlyError(ana.sb, 'list_team', {}, 'gerente');
    });

    await t.step('escrita direta em qualquer tabela é bloqueada para gerente e funcionário', async () => {
      // Uma coluna real de cada tabela: o erro precisa ser de privilégio, não de coluna inexistente.
      const probe: Record<string, [string, unknown]> = {
        stores: ['name', 'x'],
        profiles: ['name', 'x'],
        access_codes: ['code_hash', 'x'],
        products: ['name', 'x'],
        areas: ['name', 'x'],
        area_products: ['position', 9],
        tasks: ['note', 'x'],
        task_items: ['counted', 9],
        task_events: ['text', 'x'],
        captures: ['error', 'x'],
        stock_entries: ['quantity', 9],
      };
      for (const sb of [A.sb, ana.sb]) {
        for (const table of TABLES) {
          const [col, value] = probe[table];
          const results = {
            insert: await sb.from(table).insert({ [col]: value }),
            update: await sb.from(table).update({ [col]: value }).not(col, 'is', null),
            delete: await sb.from(table).delete().not(col, 'is', null),
            upsert: await sb.from(table).upsert({ [col]: value }),
          };
          for (const [op, r] of Object.entries(results)) {
            assert(/permission denied/i.test(r.error?.message ?? ''), `${op} em ${table}: ${r.error?.message}`);
          }
        }
      }
      const promote = await ana.sb.from('profiles').update({ role: 'manager' }).eq('id', ana.id);
      assert(promote.error);
      assertEquals((await rpc(ana.sb, 'whoami')).user.role, 'employee');
    });

    await t.step('funcionário não lê e-mails da equipe pela tabela', async () => {
      const { error } = await ana.sb.from('profiles').select('email');
      assert(error, 'coluna email não deve ser legível pela API');
      const { data } = await ana.sb.from('profiles').select('id, name, role');
      assert((data?.length ?? 0) >= 3, 'demais colunas continuam legíveis para a equipe');
    });

    await t.step('respostas das RPCs não carregam hash de código nem dados de outra loja', async () => {
      const blobs = [
        await rpc(A.sb, 'list_team'),
        await rpc(A.sb, 'whoami'),
        await rpc(A.sb, 'get_dashboard'),
        await rpc(ana.sb, 'list_tasks', { p_scope: 'all' }),
      ].map((x) => JSON.stringify(x));
      for (const blob of blobs) {
        assert(!blob.includes('code_hash'));
        assert(!blob.includes(B.storeId));
      }
    });
  },
});

// ===========================================================================
// API4 — Unrestricted Resource Consumption
// ===========================================================================
Deno.test({
  name: 'API4 · Limites de tamanho e de volume',
  ...net,
  async fn(t) {
    const long = (n: number) => 'x'.repeat(n);
    const cases: [string, Record<string, unknown>][] = [
      ['create_product', { p_name: long(151), p_photos: [storeA.photo] }],
      ['create_product', { p_name: 'ok', p_variant: long(101), p_photos: [storeA.photo] }],
      ['create_product', { p_name: 'ok', p_barcode: long(65), p_photos: [storeA.photo] }],
      ['create_product', { p_name: 'ok', p_min_stock: 1_000_001, p_photos: [storeA.photo] }],
      ['create_product', { p_name: 'ok', p_min_stock: -1, p_photos: [storeA.photo] }],
      ['update_product', { p_id: storeA.products[0].id, p_variant: long(100_000) }],
      ['create_area', { p_name: long(101), p_product_ids: [] }],
      ['create_area', { p_name: 'ok', p_description: long(501), p_product_ids: [] }],
      ['create_area', { p_name: null, p_product_ids: [] }],
      ['update_area', { p_id: storeA.area.id, p_name: '   ' }],
      ['update_area', { p_id: storeA.area.id, p_description: long(100_000) }],
      ['create_tasks', { p_area_ids: [storeA.area.id], p_note: long(1001) }],
      ['update_task', { p_id: storeA.task.id, p_patch: { note: long(100_000) } }],
      ['request_recount', { p_id: storeA.task.id, p_note: long(501) }],
      ['update_counting_instruction', { p_instruction: long(2001) }],
      ['import_products', { p_items: Array.from({ length: 1001 }, (_, i) => ({ name: `p${i}` })) }],
      ['import_products', { p_items: [{ name: 'a', min_stock: '99999999999' }] }],
      ['import_products', { p_items: [{ name: 'a', variant: long(101) }] }],
    ];
    for (const [fn, args] of cases) {
      const label = JSON.stringify(args, (_, v) => (typeof v === 'string' && v.length > 20 ? `${v.length}×` : v));
      await t.step(`${fn} ${label.slice(0, 90)} → erro amigável`, async () => {
        await expectFriendlyError(A.sb, fn, args);
      });
    }

    await t.step('nada foi gravado pelas tentativas acima', async () => {
      const product = await rpc(A.sb, 'get_product', { p_id: storeA.products[0].id });
      assertEquals(product.variant, '90 g');
      const task = await rpc(A.sb, 'get_task', { p_id: storeA.task.id });
      assertEquals(task.note, '');
    });

    await t.step('importação no limite (1000 itens) é aceita', async () => {
      const m = await newManager('Loja Importação');
      const r = await rpc(m.sb, 'import_products', {
        p_items: Array.from({ length: 1000 }, (_, i) => ({ name: `Produto ${i}`, min_stock: '3' })),
      });
      assertEquals(r.count, 1000);
    });

    await t.step('Storage: limite de 10 MB e só imagens', async () => {
      const big = await ana.sb.storage.from('media').upload(
        `${A.storeId}/captures/${uuid()}/f0001.jpg`,
        new Uint8Array(10 * 1024 * 1024 + 1),
        { contentType: 'image/jpeg' },
      );
      assert(big.error, 'arquivo acima de 10 MB deveria ser recusado');
      for (const contentType of ['text/html', 'image/svg+xml', 'application/javascript', 'application/pdf']) {
        const r = await ana.sb.storage.from('media').upload(
          `${A.storeId}/captures/${uuid()}/f0001.jpg`,
          new TextEncoder().encode('<script>alert(1)</script>'),
          { contentType },
        );
        assert(r.error, `${contentType} deveria ser recusado`);
      }
    });

    await t.step('captura aceita no máximo 40 quadros', async () => {
      const frames = Array.from({ length: 41 }, (_, i) => ({
        id: `f${String(i + 1).padStart(4, '0')}`,
        path: `${captureA.upload_prefix}f${String(i + 1).padStart(4, '0')}.jpg`,
        timestamp_seconds: i,
      }));
      await expectFriendlyError(ana.sb, 'register_capture_frames', {
        p_capture_id: captureA.capture_id,
        p_frames: frames,
        p_selected_frame_ids: ['f0001'],
        p_primary_frame_id: 'f0001',
      }, 'entre 1 e 40');
    });

    await t.step('create-employee valida o nome', async () => {
      for (const name of ['', '   ', 'x'.repeat(101)]) {
        const r = await callFunction('create-employee', { name }, { Authorization: `Bearer ${A.accessToken}` });
        assertEquals(r.status, 422, `nome ${JSON.stringify(name).slice(0, 20)}`);
      }
    });
  },
});

// ===========================================================================
// API5 — Broken Function Level Authorization
// ===========================================================================
Deno.test({
  name: 'API5 · BFLA: funcionário não executa funções de gerente nem do pipeline',
  ...net,
  async fn(t) {
    for (const [fn, args] of ALL_RPCS.filter(([fn]) => MANAGER_ONLY.has(fn))) {
      await t.step(`funcionário → ${fn}`, async () => {
        await expectFriendlyError(ana.sb, fn, args, 'gerente');
      });
    }
    await t.step('funcionário → Edge Function create-employee', async () => {
      const r = await callFunction('create-employee', { name: 'Clone' }, { Authorization: `Bearer ${ana.accessToken}` });
      assertEquals(r.status, 403);
    });
    await t.step('funcionário não envia foto de produto', async () => {
      const r = await ana.sb.storage.from('media').upload(`${A.storeId}/products/${uuid()}.jpg`, image, {
        contentType: 'image/jpeg',
      });
      assert(r.error);
    });
    for (const [fn, args] of PIPELINE_RPCS) {
      await t.step(`gerente autenticado → ${fn} (exclusiva do service role)`, async () => {
        const message = await expectDenied(A.sb, fn, args);
        assert(/permission denied/i.test(message), message);
      });
    }
    await t.step('captura segue intacta depois dos ataques ao pipeline', async () => {
      assertEquals(await captureStatus(captureA.capture_id), { status: 'processing', stage: 'frames' });
    });
    await t.step('cabeçalho interno forjado não pula a verificação de acesso', async () => {
      for (const forged of [ANON_KEY, B.accessToken, 'true', '1']) {
        const r = await callFunction('analyze-capture', { capture_id: captureA.capture_id }, {
          Authorization: `Bearer ${B.accessToken}`,
          'x-contabot-internal': forged,
        });
        assertEquals(r.status, 404, `x-contabot-internal=${forged.slice(0, 10)}…`);
      }
    });
  },
});

// ===========================================================================
// API6 — Fluxos de negócio sensíveis (máquina de estados)
// ===========================================================================
Deno.test({
  name: 'API6 · Máquina de estados da contagem não aceita atalhos',
  ...net,
  async fn(t) {
    const store = await populateStore(await newManager('Loja Estados'));
    const m = store.manager.sb;
    const id = store.task.id;
    const counts = countsFor(store.products, 2);

    await t.step('contagem aberta: não pode ser enviada, aprovada nem receber recontagem', async () => {
      await expectFriendlyError(m, 'submit_task', { p_id: id, p_counts: counts }, 'em revisão');
      await expectFriendlyError(m, 'approve_task', { p_id: id }, 'enviadas ou em revisão');
      await expectFriendlyError(m, 'request_recount', { p_id: id, p_note: 'x' }, 'enviadas');
    });

    await rpc(m, 'switch_to_manual', { p_id: id });

    await t.step('contagens inválidas são recusadas sem gravar nada', async () => {
      const [p1, p2] = store.products;
      const invalid: Record<string, unknown>[] = [
        { [p1.id]: 1 }, // falta produto
        { ...counts, [crypto.randomUUID()]: 1 }, // produto fora da contagem
        { [p1.id]: -1, [p2.id]: 1 },
        { [p1.id]: 1.5, [p2.id]: 1 },
        { [p1.id]: '7', [p2.id]: 1 },
        { [p1.id]: true, [p2.id]: 1 },
        { [p1.id]: [1], [p2.id]: 1 },
        { [p1.id]: 1e12, [p2.id]: 1 },
        { [p1.id]: 1_000_001, [p2.id]: 1 },
      ];
      for (const p_counts of invalid) {
        await expectFriendlyError(m, 'submit_task', { p_id: id, p_counts });
      }
      for (const p_counts of [[], 'texto', 42, null]) {
        await expectFriendlyError(m, 'submit_task', { p_id: id, p_counts });
      }
      const detail = await rpc(m, 'get_task', { p_id: id });
      assertEquals(detail.status, 'review');
      assert(detail.items.every((i: { counted: number | null }) => i.counted === null));
    });

    await t.step('envio duplicado e captura após envio são recusados', async () => {
      await rpc(m, 'submit_task', { p_id: id, p_counts: counts });
      await expectFriendlyError(m, 'submit_task', { p_id: id, p_counts: counts }, 'em revisão');
      await expectFriendlyError(m, 'start_capture', { p_task_id: id }, 'em aberto ou em revisão');
      await expectFriendlyError(m, 'switch_to_manual', { p_id: id }, 'status atual');
    });

    await t.step('aprovação grava o estoque uma vez e a contagem fica imutável', async () => {
      await rpc(m, 'approve_task', { p_id: id });
      await expectFriendlyError(m, 'approve_task', { p_id: id });
      await expectFriendlyError(m, 'request_recount', { p_id: id, p_note: 'x' });
      await expectFriendlyError(m, 'delete_task', { p_id: id }, 'aprovadas');
      const { count } = await admin.from('stock_entries').select('id', { count: 'exact', head: true }).eq('task_id', id);
      assertEquals(count, store.products.length);
    });

    await t.step('quadros de captura: caminho, formato e dono são validados', async () => {
      const [task] = await rpc(m, 'create_tasks', { p_area_ids: [store.area.id] });
      const cap = await rpc(m, 'start_capture', { p_task_id: task.id });
      const path = `${cap.upload_prefix}f0001.jpg`;
      await store.manager.sb.storage.from('media').upload(path, image, { contentType: 'image/jpeg' });
      const frame = { id: 'f0001', path, timestamp_seconds: 0 };
      const bad: Record<string, unknown>[] = [
        { ...frame, path: store.photo }, // aponta para foto de produto
        { ...frame, path: `${cap.upload_prefix}../f0001.jpg` },
        { ...frame, path: `${cap.upload_prefix}f0002.jpg` }, // não enviado
        { ...frame, id: "f0001'; drop table public.tasks; --" },
        { ...frame, timestamp_seconds: -1 },
        { ...frame, timestamp_seconds: '0' },
      ];
      for (const f of bad) {
        await expectFriendlyError(m, 'register_capture_frames', {
          p_capture_id: cap.capture_id,
          p_frames: [f],
          p_selected_frame_ids: [String(f.id)],
          p_primary_frame_id: String(f.id),
        }, /inválid/);
      }
      // Regressões encontradas pelo fuzzing: NULL passava pela validação (lógica de três valores).
      await expectFriendlyError(m, 'register_capture_frames', {
        p_capture_id: cap.capture_id,
        p_frames: null,
        p_selected_frame_ids: ['f0001'],
        p_primary_frame_id: 'f0001',
      }, 'entre 1 e 40');
      await expectFriendlyError(m, 'register_capture_frames', {
        p_capture_id: cap.capture_id,
        p_frames: [frame],
        p_selected_frame_ids: ['f0001'],
        p_primary_frame_id: null,
      }, 'Seleção');
      await expectFriendlyError(m, 'register_capture_frames', {
        p_capture_id: cap.capture_id,
        p_frames: ['f0001'],
        p_selected_frame_ids: ['f0001'],
        p_primary_frame_id: 'f0001',
      }, 'inválido');
      await expectFriendlyError(m, 'register_capture_frames', {
        p_capture_id: cap.capture_id,
        p_frames: [frame, frame],
        p_selected_frame_ids: ['f0001'],
        p_primary_frame_id: 'f0001',
      }, 'repetidos');
      await expectFriendlyError(m, 'register_capture_frames', {
        p_capture_id: cap.capture_id,
        p_frames: [frame],
        p_selected_frame_ids: ['f9999'],
        p_primary_frame_id: 'f9999',
      }, 'Seleção');
      await rpc(m, 'register_capture_frames', {
        p_capture_id: cap.capture_id,
        p_frames: [frame],
        p_selected_frame_ids: ['f0001'],
        p_primary_frame_id: 'f0001',
      });
      await expectFriendlyError(m, 'register_capture_frames', {
        p_capture_id: cap.capture_id,
        p_frames: [frame],
        p_selected_frame_ids: ['f0001'],
        p_primary_frame_id: 'f0001',
      }, 'não aceita mais quadros');
    });
  },
});

// ===========================================================================
// API8 / API10 — Injeção, configuração e vazamento de informação
// ===========================================================================
const INJECTION_PAYLOADS = [
  "'; drop table public.tasks; --",
  "' or '1'='1",
  '"; select pg_sleep(5); --',
  '$$; select pg_sleep(5); $$',
  "'); delete from public.products; --",
  '<script>alert(document.cookie)</script>',
  '{{7*7}} ${7*7} #{7*7}',
  '../../../../etc/passwd',
  'Ação 🍫 — café “especial” ñ',
  '\\x27 \\u0027 %27',
];

Deno.test({
  name: 'API8 · Injeção: payloads são gravados literalmente e o banco segue íntegro',
  ...net,
  async fn(t) {
    const m = await newManager('Loja Injeção');
    const photo = `${m.storeId}/products/${uuid()}.jpg`;
    await m.sb.storage.from('media').upload(photo, image, { contentType: 'image/jpeg' });

    for (const payload of INJECTION_PAYLOADS) {
      await t.step(`payload ${JSON.stringify(payload).slice(0, 40)}`, async () => {
        const started = performance.now();
        const product = await rpc(m.sb, 'create_product', {
          p_name: payload,
          p_variant: payload.slice(0, 100),
          p_barcode: payload.slice(0, 64),
          p_photos: [photo],
        });
        assertEquals(product.name, payload.trim());
        const area = await rpc(m.sb, 'create_area', {
          p_name: payload.slice(0, 100),
          p_description: payload,
          p_product_ids: [product.id],
        });
        assertEquals(area.description, payload.trim());
        const [task] = await rpc(m.sb, 'create_tasks', { p_area_ids: [area.id], p_note: payload });
        assertEquals(task.note, payload.trim());
        const list = await rpc(m.sb, 'list_tasks', { p_scope: payload, p_statuses: [payload] });
        assertEquals(list, []);
        assert(performance.now() - started < 4000, 'pg_sleep injetado não pode executar');
      });
    }

    await t.step('tabelas continuam existindo e com dados', async () => {
      for (const table of ['tasks', 'products', 'areas']) {
        const { error, count } = await admin.from(table).select('*', { count: 'exact', head: true });
        assert(!error, `${table}: ${error?.message}`);
        assert((count ?? 0) > 0);
      }
    });

    await t.step('busca por payload no PostgREST não escapa do filtro', async () => {
      const { data, error } = await m.sb.from('products').select('id').eq('name', "' or '1'='1");
      assert(!error);
      assertEquals(data?.length, 1, 'encontra apenas o produto com o nome literal');
      const or = await m.sb.from('products').select('id').or(`name.eq.x,store_id.neq.${m.storeId}`);
      assertEquals(or.data ?? [], [], 'filtro "or" não fura a RLS');
    });
  },
});

Deno.test({
  name: 'API8 · Configuração: bucket privado, CORS, métodos e erros sem vazamento',
  ...net,
  async fn(t) {
    await t.step('bucket "media" é privado, com limite de tamanho e tipos', async () => {
      const { data } = await admin.storage.getBucket('media');
      assertEquals(data?.public, false);
      assertEquals(data?.file_size_limit, 10 * 1024 * 1024);
      assertEquals([...(data?.allowed_mime_types ?? [])].sort(), ['image/jpeg', 'image/png', 'image/webp']);
    });

    await t.step('Edge Functions: OPTIONS responde CORS e métodos ≠ POST dão 405', async () => {
      for (const name of ['join-store', 'create-employee', 'analyze-capture']) {
        const pre = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, { method: 'OPTIONS' });
        await pre.body?.cancel();
        assertEquals(pre.status, 200);
        assert(pre.headers.get('access-control-allow-methods')?.includes('POST'));
        const get = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
          headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
        });
        const body = await get.json();
        assertEquals(get.status, 405);
        assertEquals(body.detail, 'Use POST.');
      }
    });

    await t.step('Edge Functions: corpo malformado nunca gera 500', async () => {
      const auth = { Authorization: `Bearer ${A.accessToken}` };
      const cases: [string, unknown][] = [
        ['analyze-capture', '{malformado'],
        ['analyze-capture', { capture_id: "1' or '1'='1" }],
        ['analyze-capture', { capture_id: ['x'] }],
        ['analyze-capture', []],
        ['create-employee', '{malformado'],
        ['create-employee', { name: { $gt: '' } }],
        ['create-employee', []],
      ];
      for (const [name, body] of cases) {
        const r = await callFunction(name, body, auth);
        assert(r.status >= 400 && r.status < 500, `${name} ${JSON.stringify(body)} → ${r.status}`);
        assertNoInternalLeak(JSON.stringify(r.body), name);
      }
    });

    await t.step('erros de validação das RPCs não expõem nomes de tabelas ou constraints', async () => {
      await expectFriendlyError(A.sb, 'update_task', { p_id: storeA.task.id, p_patch: { due_date: 'amanhã' } });
      await expectFriendlyError(A.sb, 'update_task', { p_id: storeA.task.id, p_patch: { assignee_id: 'x' } });
      await expectFriendlyError(A.sb, 'update_task', { p_id: storeA.task.id, p_patch: 'texto' });
      await expectFriendlyError(A.sb, 'create_area', { p_name: '', p_product_ids: [] });
      await expectFriendlyError(A.sb, 'create_area', {
        p_name: 'x',
        p_product_ids: [storeA.products[0].id, storeA.products[0].id],
      }, 'repetidos');
      await expectFriendlyError(A.sb, 'import_products', { p_items: { name: 'x' } });
      await expectFriendlyError(A.sb, 'import_products', { p_items: [] });
    });
  },
});
