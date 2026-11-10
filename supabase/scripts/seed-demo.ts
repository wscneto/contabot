/**
 * Dados de demonstração (Mercadinho Bom Preço), equivalentes ao antigo seed_demo.py.
 *
 * Uso (Supabase local):
 *   deno run --allow-net --allow-read --allow-env --env-file=supabase/.env.seed supabase/scripts/seed-demo.ts
 * ou, sem arquivo:
 *   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=... deno run -A supabase/scripts/seed-demo.ts
 *
 * Recria a loja de demonstração a cada execução (apaga a anterior, se existir).
 */
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

const MANAGER_EMAIL = 'demo@contabot.app';
const MANAGER_PASSWORD = 'contabot';
const STORE_NAME = 'Mercadinho Bom Preço';
const EMPLOYEES = [
  { key: 'ana', name: 'Ana Balcão', code: 'ANA1-2345' },
  { key: 'joao', name: 'João Estoque', code: 'JOAO-6789' },
] as const;
const PRODUCTS = [
  { key: 'choco', name: 'Chocolate Ao Leite', variant: '90g', barcode: '7891000100011', min: 15 },
  { key: 'biscoito', name: 'Biscoito Morango', variant: '140g', barcode: '7891000100022', min: 20 },
  { key: 'cafe', name: 'Café Torrado', variant: '500g', barcode: '7891000100033', min: 10 },
  { key: 'leite', name: 'Leite Integral', variant: '1L', barcode: '7891000100044', min: 24 },
  { key: 'arroz', name: 'Arroz Branco', variant: '5kg', barcode: '7891000100055', min: 15 },
  { key: 'feijao', name: 'Feijão Carioca', variant: '1kg', barcode: '7891000100066', min: 15 },
  { key: 'acucar', name: 'Açúcar Refinado', variant: '1kg', barcode: '7891000100077', min: 12 },
  { key: 'oleo', name: 'Óleo de Soja', variant: '900ml', barcode: '7891000100088', min: 16 },
] as const;
const AREAS = [
  { key: 'mercearia', name: 'Gôndola 3 – Mercearia', description: 'Alimentos básicos e grãos', products: ['arroz', 'feijao', 'oleo', 'acucar'] },
  { key: 'matinais', name: 'Corredor 1 – Matinais', description: 'Bebidas, café e doces', products: ['cafe', 'leite', 'choco', 'biscoito'] },
  { key: 'paletes', name: 'Depósito – Paletes', description: 'Estoque de piso e caixas fechadas', products: ['arroz', 'leite', 'acucar'] },
] as const;

const imagesDir = new URL('../seed/images/', import.meta.url);

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function check<T>(result: { data: T; error: unknown }, what: string): T {
  if (result.error) throw new Error(`${what}: ${JSON.stringify(result.error)}`);
  return result.data;
}

async function removeExisting(admin: SupabaseClient) {
  const { data: manager } = await admin.from('profiles').select('store_id').eq('email', MANAGER_EMAIL).maybeSingle();
  if (!manager) return;
  const storeId = manager.store_id as string;
  const members = check(await admin.from('profiles').select('id').eq('store_id', storeId), 'listar equipe');
  for (const folder of ['products', 'captures']) {
    const prefix = `${storeId}/${folder}`;
    const { data: entries } = await admin.storage.from('media').list(prefix, { limit: 1000 });
    for (const entry of entries ?? []) {
      // Capturas têm uma subpasta por captura.
      const { data: nested } = await admin.storage.from('media').list(`${prefix}/${entry.name}`, { limit: 1000 });
      const paths = nested?.length
        ? nested.map((n) => `${prefix}/${entry.name}/${n.name}`)
        : [`${prefix}/${entry.name}`];
      await admin.storage.from('media').remove(paths);
    }
  }
  check(await admin.from('stores').delete().eq('id', storeId), 'apagar loja');
  for (const member of members ?? []) await admin.auth.admin.deleteUser(member.id);
  console.log('Loja de demonstração anterior removida.');
}

async function upload(admin: SupabaseClient, path: string, file: string) {
  const bytes = await Deno.readFile(new URL(file, imagesDir));
  check(await admin.storage.from('media').upload(path, bytes, { contentType: 'image/jpeg', upsert: true }), `enviar ${path}`);
  return path;
}

async function main() {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.');
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  await removeExisting(admin);

  const now = new Date();
  const iso = (daysAgo: number) => new Date(now.getTime() - daysAgo * 86_400_000).toISOString();
  const today = now.toISOString().slice(0, 10);

  // Gerente: o gatilho handle_new_user cria a loja e o perfil.
  const manager = check(
    await admin.auth.admin.createUser({
      email: MANAGER_EMAIL,
      password: MANAGER_PASSWORD,
      email_confirm: true,
      user_metadata: { name: 'Carla Gerente', store_name: STORE_NAME },
    }),
    'criar gerente',
  ).user!;
  const storeId = check(await admin.from('profiles').select('store_id').eq('id', manager.id).single(), 'perfil')
    .store_id as string;

  const employees: Record<string, string> = {};
  for (const emp of EMPLOYEES) {
    const user = check(
      await admin.auth.admin.createUser({
        email: `funcionario-${emp.key}-demo@contabot.invalid`,
        email_confirm: true,
        password: crypto.randomUUID() + crypto.randomUUID(),
        app_metadata: { contabot_role: 'employee', store_id: storeId },
        user_metadata: { name: emp.name },
      }),
      `criar ${emp.name}`,
    ).user!;
    employees[emp.key] = user.id;
    check(
      await admin.from('profiles').insert({ id: user.id, store_id: storeId, name: emp.name, role: 'employee', created_at: iso(2) }),
      `perfil ${emp.name}`,
    );
    const codeHash = await sha256Hex(emp.code.replace(/[^A-Za-z0-9]/g, '').toUpperCase());
    check(await admin.from('access_codes').insert({ user_id: user.id, code_hash: codeHash }), 'código de acesso');
  }
  check(
    await admin.from('stores').update({ created_at: iso(2) }).eq('id', storeId),
    'data da loja',
  );

  const products: Record<string, { id: string; name: string; variant: string; photo: string }> = {};
  for (const p of PRODUCTS) {
    const photo = await upload(admin, `${storeId}/products/demo-${p.key}.jpg`, `product-${p.key}.jpg`);
    const row = check(
      await admin.from('products').insert({
        store_id: storeId,
        name: p.name,
        variant: p.variant,
        barcode: p.barcode,
        min_stock: p.min,
        photos: [photo],
        created_at: iso(2),
        updated_at: iso(2),
      }).select('id').single(),
      `produto ${p.name}`,
    );
    products[p.key] = { id: row.id, name: p.name, variant: p.variant, photo };
  }

  const areas: Record<string, string> = {};
  for (const a of AREAS) {
    const row = check(
      await admin.from('areas').insert({
        store_id: storeId,
        name: a.name,
        description: a.description,
        created_at: iso(2),
        updated_at: iso(2),
      }).select('id').single(),
      `área ${a.name}`,
    );
    areas[a.key] = row.id;
    check(
      await admin.from('area_products').insert(
        a.products.map((pk, position) => ({ area_id: row.id, product_id: products[pk].id, position })),
      ),
      'produtos da área',
    );
  }

  const item = (taskId: string, pk: string, extra: Record<string, unknown> = {}) => ({
    task_id: taskId,
    product_id: products[pk].id,
    name: products[pk].name,
    variant: products[pk].variant,
    photo: products[pk].photo,
    ai_status: 'manual',
    ...extra,
  });
  const event = (taskId: string, text: string, at: string) => ({ task_id: taskId, text, created_at: at });
  const insertTask = async (row: Record<string, unknown>) =>
    check(await admin.from('tasks').insert({ store_id: storeId, ...row }).select('id').single(), 'contagem').id as string;

  // 1. Contagem histórica aprovada (dois dias atrás).
  const hist = await insertTask({
    area_id: areas.mercearia,
    status: 'approved',
    due_date: iso(2).slice(0, 10),
    assignee_id: employees.ana,
    note: 'Inventário semanal',
    created_at: iso(2),
    updated_at: iso(2),
    submitted_at: iso(2),
    approved_at: iso(2),
    submitted_by_id: employees.ana,
  });
  const histCounts: Record<string, number> = { arroz: 18, feijao: 14, oleo: 12, acucar: 9 };
  check(
    await admin.from('task_items').insert(
      Object.entries(histCounts).map(([pk, qty]) =>
        item(hist, pk, { ai_quantity: qty, ai_status: 'ok', ai_note: 'Contagem confirmada', counted: qty, final: qty })
      ),
    ),
    'itens históricos',
  );
  check(
    await admin.from('stock_entries').insert(
      Object.entries(histCounts).map(([pk, qty]) => ({
        store_id: storeId,
        area_id: areas.mercearia,
        product_id: products[pk].id,
        quantity: qty,
        task_id: hist,
        counted_at: iso(2),
      })),
    ),
    'estoque histórico',
  );
  check(await admin.from('task_events').insert(event(hist, 'Aprovada pelo gerente Carla Gerente', iso(2))), 'evento');

  // 2. Enviada pela Ana, aguardando aprovação, com captura simulada de 2 quadros.
  const sub = await insertTask({
    area_id: areas.matinais,
    status: 'submitted',
    due_date: today,
    assignee_id: employees.ana,
    note: 'Contagem de rotina',
    created_at: iso(1),
    submitted_at: iso(0),
    submitted_by_id: employees.ana,
  });
  const capture = check(
    await admin.from('captures').insert({
      task_id: sub,
      store_id: storeId,
      status: 'done',
      simulated: true,
      by_user_id: employees.ana,
      model: 'simulador-demonstracao',
      created_at: iso(1),
    }).select('id').single(),
    'captura',
  ).id as string;
  const f1 = await upload(admin, `${storeId}/captures/${capture}/f0001.jpg`, 'frame-1.jpg');
  const f2 = await upload(admin, `${storeId}/captures/${capture}/f0002.jpg`, 'frame-2.jpg');
  check(
    await admin.from('captures').update({
      result_frames: [
        { id: 'f0001', path: f1, timestamp_seconds: 2.5 },
        { id: 'f0002', path: f2, timestamp_seconds: 6.8 },
      ],
    }).eq('id', capture),
    'quadros da captura',
  );
  check(
    await admin.from('task_items').insert([
      item(sub, 'cafe', { ai_quantity: 12, ai_status: 'ok', ai_note: 'Contagem nítida de todas as unidades.', evidence_frame: f1, counted: 12 }),
      item(sub, 'leite', { ai_quantity: 30, ai_status: 'ok', ai_note: 'Unidades alinhadas na prateleira.', evidence_frame: f1, counted: 30 }),
      item(sub, 'choco', { ai_quantity: 8, ai_status: 'check', ai_note: 'Parte das caixas estava sobreposta no fundo.', evidence_frame: f2, counted: 10 }),
      item(sub, 'biscoito', { ai_quantity: null, ai_status: 'missing', ai_note: 'Produto não avistado nos frames enviados.', counted: 0 }),
    ]),
    'itens enviados',
  );
  check(
    await admin.from('task_events').insert([
      event(sub, 'Criada por Carla Gerente', iso(1)),
      event(sub, 'Vídeo enviado por Ana Balcão', iso(0)),
      event(sub, 'Enviada para aprovação por Ana Balcão', iso(0)),
    ]),
    'eventos',
  );

  // 3. Aberta para a Ana.
  const open = await insertTask({
    area_id: areas.mercearia,
    status: 'open',
    due_date: today,
    assignee_id: employees.ana,
    note: 'Filmar da esquerda para a direita devagar',
  });
  check(await admin.from('task_items').insert(['arroz', 'feijao', 'oleo', 'acucar'].map((pk) => item(open, pk))), 'itens');
  check(await admin.from('task_events').insert(event(open, 'Criada por Carla Gerente', iso(0))), 'evento');

  // 4. Recontagem solicitada ao João.
  const recount = await insertTask({
    area_id: areas.paletes,
    status: 'open',
    recount_requested: true,
    due_date: today,
    assignee_id: employees.joao,
    note: 'Contagem do estoque de paletes',
    manager_note: 'Favor conferir o lote do canto direito que chegou hoje.',
    created_at: iso(1),
  });
  check(await admin.from('task_items').insert(['arroz', 'leite', 'acucar'].map((pk) => item(recount, pk))), 'itens');
  check(
    await admin.from('task_events').insert([
      event(recount, 'Criada por Carla Gerente', iso(1)),
      event(recount, 'Recontagem solicitada por Carla Gerente: Favor conferir o lote do canto direito', iso(0)),
    ]),
    'eventos',
  );

  console.log(`
✅ Demonstração semeada com sucesso!
📦 Loja: ${STORE_NAME}
👩‍💼 Gerente: Carla Gerente  —  ${MANAGER_EMAIL} / ${MANAGER_PASSWORD}
👷 Ana Balcão  —  código ${EMPLOYEES[0].code}
👷 João Estoque  —  código ${EMPLOYEES[1].code}
`);
}

await main();
