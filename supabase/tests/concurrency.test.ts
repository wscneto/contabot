/**
 * Testes de concorrência: várias requisições simultâneas sobre o mesmo objeto
 * (cliques duplos, dois aparelhos, reenvio automático da rede) não podem
 * duplicar contagens, estoque ou análises, nem furar limites.
 *
 * Execução: mesmos pré-requisitos de supabase/tests/integration.test.ts.
 */
import {
  admin,
  assert,
  assertEquals,
  countsFor,
  image,
  newManager,
  net,
  populateStore,
  rpc,
  tryRpc,
  waitForTaskStatus,
} from './_helpers.ts';
import { computeFingerprint } from '../functions/_shared/frame-selection.ts';

const PARALLEL = 8;

const parallel = <T>(n: number, fn: (i: number) => Promise<T>) => Promise.all(Array.from({ length: n }, (_, i) => fn(i)));

Deno.test({
  name: 'criar contagem da mesma área em paralelo abre uma única contagem',
  ...net,
  async fn() {
    const store = await populateStore(await newManager('Loja Corrida 1'));
    const area = await rpc(store.manager.sb, 'create_area', {
      p_name: 'Área disputada',
      p_product_ids: store.products.map((p) => p.id),
    });
    const results = await parallel(PARALLEL, () => rpc(store.manager.sb, 'create_tasks', { p_area_ids: [area.id] }));
    const ids = new Set(results.map((r) => r[0].id));
    assertEquals(ids.size, 1, `contagens criadas: ${[...ids].join(', ')}`);
    const { count } = await admin.from('tasks').select('id', { count: 'exact', head: true }).eq('area_id', area.id);
    assertEquals(count, 1);
    const { count: items } = await admin.from('task_items').select('task_id', { count: 'exact', head: true })
      .eq('task_id', [...ids][0]);
    assertEquals(items, store.products.length, 'itens não duplicados');
  },
});

Deno.test({
  name: 'envio e aprovação simultâneos: exatamente um vence e o estoque não duplica',
  ...net,
  async fn() {
    const store = await populateStore(await newManager('Loja Corrida 2'));
    const sb = store.manager.sb;
    await rpc(sb, 'switch_to_manual', { p_id: store.task.id });

    const submits = await parallel(
      PARALLEL,
      (i) => tryRpc(sb, 'submit_task', { p_id: store.task.id, p_counts: countsFor(store.products, i + 1) }),
    );
    assertEquals(submits.filter((r) => !r.error).length, 1, JSON.stringify(submits.map((r) => r.error?.message)));
    assert(submits.filter((r) => r.error).every((r) => r.error!.message.includes('em revisão')));

    const approvals = await parallel(PARALLEL, () => tryRpc(sb, 'approve_task', { p_id: store.task.id }));
    assertEquals(approvals.filter((r) => !r.error).length, 1);

    const { data: entries } = await admin.from('stock_entries').select('product_id, quantity').eq(
      'task_id',
      store.task.id,
    );
    assertEquals(entries?.length, store.products.length, 'uma entrada de estoque por produto');
    const winner = submits.find((r) => !r.error)!.data;
    for (const item of winner.items) {
      assertEquals(entries?.find((e) => e.product_id === item.product_id)?.quantity, item.counted);
    }
  },
});

Deno.test({
  name: 'iniciar captura em paralelo na mesma contagem cria uma única captura',
  ...net,
  async fn() {
    const store = await populateStore(await newManager('Loja Corrida 3'));
    const results = await parallel(PARALLEL, () => tryRpc(store.manager.sb, 'start_capture', { p_task_id: store.task.id }));
    assertEquals(results.filter((r) => !r.error).length, 1);
    const { count } = await admin.from('captures').select('id', { count: 'exact', head: true })
      .eq('task_id', store.task.id);
    assertEquals(count, 1);
  },
});

Deno.test({
  name: 'limite diário de análises não é furado por capturas simultâneas em contagens diferentes',
  ...net,
  async fn() {
    const manager = await newManager('Loja Corrida 4');
    const store = await populateStore(manager);
    const LIMIT = 3;
    await admin.from('stores').update({ daily_capture_limit: LIMIT }).eq('id', manager.storeId);
    const areas = await parallel(PARALLEL, (i) =>
      rpc(manager.sb, 'create_area', { p_name: `Área ${i}`, p_product_ids: [store.products[0].id] }));
    const tasks = (await rpc(manager.sb, 'create_tasks', { p_area_ids: areas.map((a) => a.id) })) as { id: string }[];

    const results = await Promise.all(tasks.map((t) => tryRpc(manager.sb, 'start_capture', { p_task_id: t.id })));
    const ok = results.filter((r) => !r.error).length;
    const { count } = await admin.from('captures').select('id', { count: 'exact', head: true })
      .eq('store_id', manager.storeId);
    assertEquals(ok, LIMIT, `capturas aceitas: ${ok}`);
    assertEquals(count, LIMIT);
    assert(results.filter((r) => r.error).every((r) => r.error!.message.includes(`Limite de ${LIMIT}`)));
  },
});

Deno.test({
  name: 'pipeline_claim: só uma execução assume cada etapa da análise',
  ...net,
  async fn() {
    const store = await populateStore(await newManager('Loja Corrida 5'));
    const cap = await rpc(store.manager.sb, 'start_capture', { p_task_id: store.task.id });
    await admin.from('captures').update({ stage: 'identifying' }).eq('id', cap.capture_id);
    const claims = await parallel(PARALLEL * 2, async () => {
      const { data, error } = await admin.rpc('pipeline_claim', { p_capture_id: cap.capture_id, p_stage: 'identifying' });
      if (error) throw error;
      return data as boolean;
    });
    assertEquals(claims.filter(Boolean).length, 1);
  },
});

Deno.test({
  name: 'disparar a análise várias vezes ao mesmo tempo processa a captura uma única vez',
  ...net,
  async fn() {
    const store = await populateStore(await newManager('Loja Corrida 6'));
    const sb = store.manager.sb;
    const start = await rpc(sb, 'start_capture', { p_task_id: store.task.id });
    const frames = [];
    for (let i = 0; i < 2; i++) {
      const id = `f000${i + 1}`;
      const path = `${start.upload_prefix}${id}.jpg`;
      await sb.storage.from('media').upload(path, image, { contentType: 'image/jpeg' });
      const data = new Uint8Array(32 * 32 * 4).map((_, j) => (j * (i + 3) * 7) % 256);
      frames.push({
        id,
        path,
        timestamp_seconds: i * 2,
        metrics: { sharpness: 100, exposure: 0.8, motion: 0, glare: 0, quality: 0.7 },
        warnings: [],
        fingerprint: computeFingerprint({ data, width: 32, height: 32 }),
      });
    }
    await rpc(sb, 'register_capture_frames', {
      p_capture_id: start.capture_id,
      p_frames: frames,
      p_selected_frame_ids: ['f0001', 'f0002'],
      p_primary_frame_id: 'f0001',
    });

    const responses = await parallel(PARALLEL, () => sb.functions.invoke('analyze-capture', {
      body: { capture_id: start.capture_id },
    }));
    assert(responses.every((r) => !r.error), JSON.stringify(responses.map((r) => r.error?.message)));

    const detail = await waitForTaskStatus(sb, store.task.id, 'analyzing');
    assertEquals(detail.status, 'review');
    assertEquals(detail.capture.status, 'done');
    const finished = detail.events.filter((e: { text: string }) => e.text.startsWith('Análise'));
    assertEquals(finished.length, 1, JSON.stringify(detail.events));
  },
});
