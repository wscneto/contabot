/**
 * Fuzzing da API: RPCs e Edge Functions recebem JSON gerado aleatoriamente
 * (fast-check). Para qualquer entrada, a resposta deve ser sucesso ou erro 4xx
 * com mensagem amigável — nunca 5xx, nunca detalhes internos do banco — e o
 * estado gravado deve continuar consistente.
 *
 * Execução: mesmos pré-requisitos de supabase/tests/integration.test.ts.
 * FUZZ_RUNS controla o número de entradas por propriedade (padrão 120).
 */
import fc from 'npm:fast-check@3.23.2';
import {
  admin,
  assert,
  assertNoInternalLeak,
  callFunction,
  type Json,
  net,
  newManager,
  populateStore,
  rpc,
} from './_helpers.ts';

const RUNS = Number(Deno.env.get('FUZZ_RUNS') ?? 120);

const store = await populateStore(await newManager('Loja Fuzz'));
const sb = store.manager.sb;
const productIds: string[] = store.products.map((p: Json) => p.id);
await rpc(sb, 'switch_to_manual', { p_id: store.task.id });

const VALID_STATUSES = new Set(['open', 'analyzing', 'review', 'submitted', 'approved']);

/** Chama a RPC e verifica o contrato de erro. Devolve true em caso de sucesso. */
async function probe(fn: string, args: Record<string, unknown>): Promise<boolean> {
  const { error, status } = await sb.rpc(fn, args);
  assert(status < 500, `${fn}(${JSON.stringify(args).slice(0, 300)}) → HTTP ${status}: ${error?.message}`);
  if (error) assertNoInternalLeak(error.message, fn);
  return !error;
}

async function assertTaskConsistent(taskId: string) {
  const { data: task } = await admin.from('tasks').select('status').eq('id', taskId).single();
  assert(VALID_STATUSES.has(task?.status), `status inválido: ${task?.status}`);
  const { data: items } = await admin.from('task_items').select('counted, final').eq('task_id', taskId);
  for (const item of items ?? []) {
    for (const v of [item.counted, item.final]) {
      assert(v === null || (Number.isInteger(v) && v >= 0 && v <= 1_000_000), `quantidade inválida gravada: ${v}`);
    }
  }
}

/** Valor JSON qualquer, com viés para números extremos e textos hostis. */
const hostile = fc.oneof(
  fc.jsonValue(),
  fc.constantFrom(-1, 1.5, 1e308, -0, 2 ** 31, 2 ** 53, '1e999', 'NaN', '', ' ', '‮', "'; drop table x; --"),
  fc.fullUnicodeString({ maxLength: 50 }).filter((s) => !s.includes('\u0000')),
);

Deno.test({
  name: 'fuzz submit_task: contagens arbitrárias nunca geram 5xx nem gravam valores inválidos',
  ...net,
  async fn() {
    // Mais da metade das entradas usa os ids reais, para chegar às validações de valor.
    const counts = fc.oneof(
      hostile,
      fc.dictionary(fc.constantFrom(...productIds), hostile),
      fc.record(Object.fromEntries(productIds.map((id) => [id, hostile]))),
    );
    await fc.assert(
      fc.asyncProperty(counts, async (p_counts) => {
        const ok = await probe('submit_task', { p_id: store.task.id, p_counts });
        if (ok) {
          // Entrada válida por acaso: volta para revisão e segue o fuzzing.
          await rpc(sb, 'request_recount', { p_id: store.task.id, p_note: 'fuzz' });
          await rpc(sb, 'switch_to_manual', { p_id: store.task.id });
        }
      }),
      { numRuns: RUNS },
    );
    await assertTaskConsistent(store.task.id);
  },
});

Deno.test({
  name: 'fuzz update_task: patches arbitrários nunca geram 5xx',
  ...net,
  async fn() {
    const patch = fc.oneof(
      hostile,
      fc.record(
        { assignee_id: hostile, due_date: hostile, note: hostile, status: hostile, store_id: hostile },
        { requiredKeys: [] },
      ),
    );
    await fc.assert(
      fc.asyncProperty(patch, async (p_patch) => {
        await probe('update_task', { p_id: store.task.id, p_patch });
      }),
      { numRuns: RUNS },
    );
    const { data } = await admin.from('tasks').select('store_id, status').eq('id', store.task.id).single();
    assert(data?.store_id === store.manager.storeId, 'patch não pode mudar a loja');
    await assertTaskConsistent(store.task.id);
  },
});

Deno.test({
  name: 'fuzz import_products: planilhas arbitrárias nunca geram 5xx nem produtos sem nome',
  ...net,
  async fn() {
    const item = fc.oneof(
      hostile,
      fc.record({ name: hostile, variant: hostile, barcode: hostile, min_stock: hostile }, { requiredKeys: [] }),
    );
    await fc.assert(
      fc.asyncProperty(fc.oneof(hostile, fc.array(item, { maxLength: 6 })), async (p_items) => {
        await probe('import_products', { p_items });
      }),
      { numRuns: RUNS },
    );
    const { data } = await admin.from('products').select('name, variant, barcode, min_stock')
      .eq('store_id', store.manager.storeId);
    for (const p of data ?? []) {
      assert(p.name.trim().length >= 1 && p.name.length <= 150, `nome inválido: ${p.name}`);
      assert(p.variant.length <= 100 && p.barcode.length <= 64);
      assert(p.min_stock === null || (p.min_stock >= 0 && p.min_stock <= 1_000_000));
    }
  },
});

Deno.test({
  name: 'fuzz register_capture_frames: quadros arbitrários nunca geram 5xx',
  ...net,
  async fn() {
    const area = await rpc(sb, 'create_area', { p_name: 'Área fuzz', p_product_ids: productIds });
    const [task] = await rpc(sb, 'create_tasks', { p_area_ids: [area.id] });
    const cap = await rpc(sb, 'start_capture', { p_task_id: task.id });
    const frame = fc.oneof(
      hostile,
      fc.record({
        id: fc.oneof(hostile, fc.stringMatching(/^f[0-9]{4}$/)),
        path: fc.oneof(hostile, fc.constant(`${cap.upload_prefix}f0001.jpg`)),
        timestamp_seconds: hostile,
      }, { requiredKeys: [] }),
    );
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(hostile, fc.array(frame, { maxLength: 5 })),
        fc.oneof(fc.constant(['f0001']), fc.array(fc.string({ maxLength: 8 }), { maxLength: 3 })),
        fc.oneof(fc.constant('f0001'), fc.string({ maxLength: 8 })),
        async (p_frames, p_selected_frame_ids, p_primary_frame_id) => {
          await probe('register_capture_frames', {
            p_capture_id: cap.capture_id,
            p_frames,
            p_selected_frame_ids,
            p_primary_frame_id,
          });
        },
      ),
      { numRuns: RUNS },
    );
    const { data } = await admin.from('captures').select('status, stage').eq('id', cap.capture_id).single();
    assert(data?.status === 'processing' && data.stage === 'frames', 'nenhum quadro inválido foi aceito');
  },
});

Deno.test({
  name: 'fuzz textos de cadastro: nomes e descrições arbitrários são gravados ou recusados com clareza',
  ...net,
  async fn() {
    await fc.assert(
      fc.asyncProperty(
        fc.fullUnicodeString({ maxLength: 160 }).filter((s) => !s.includes('\u0000')),
        fc.fullUnicodeString({ maxLength: 600 }).filter((s) => !s.includes('\u0000')),
        async (name, description) => {
          const { data, error, status } = await sb.rpc('create_area', {
            p_name: name,
            p_description: description,
            p_product_ids: [],
          });
          assert(status < 500, `HTTP ${status}: ${error?.message}`);
          if (error) {
            assertNoInternalLeak(error.message, 'create_area');
            assert(name.trim() === '' || name.trim().length > 100 || description.trim().length > 500, error.message);
          } else {
            assert(data.name === name.trim() && data.description === description.trim());
          }
        },
      ),
      { numRuns: RUNS },
    );
  },
});

Deno.test({
  name: 'fuzz join-store: corpos arbitrários sempre recebem 4xx sem token',
  ...net,
  async fn() {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(fc.jsonValue(), fc.record({ code: hostile }), fc.string({ maxLength: 200 })),
        async (body) => {
          const raw = typeof body === 'string' ? body : JSON.stringify(body);
          const r = await callFunction('join-store', raw);
          assert(r.status >= 400 && r.status < 500, `join-store(${raw.slice(0, 120)}) → ${r.status}`);
          assert(!(r.body && typeof r.body === 'object' && 'token_hash' in r.body));
        },
      ),
      { numRuns: RUNS },
    );
  },
});
