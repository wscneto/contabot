/**
 * Análise de uma captura: identificar → contar, com o modelo configurado em
 * VISION_* (ver _shared/providers.ts).
 *
 * O celular já escolheu e enviou os quadros (register_capture_frames deixa a
 * captura em stage "identifying") e chama esta função com { capture_id }.
 * Cada etapa roda numa invocação própria, em segundo plano (EdgeRuntime.waitUntil),
 * para caber no limite de tempo das Edge Functions: a identificação termina
 * disparando a contagem por uma chamada interna.
 */
import {
  type CatalogEntry,
  countingFrames,
  countItems,
  identificationBatches,
  mergeIdentifications,
  noMatchItems,
  possibleSkus,
  type StoredFrame,
  toResultFrames,
} from '../_shared/analysis.ts';
import { corsHeaders, fail, json, readJson } from '../_shared/http.ts';
import { type VisionImage, type VisionSettings, visionSettingsFromEnv, type VisionSku } from '../_shared/providers.ts';
import { adminClient, bearerToken, userClient } from '../_shared/supabase.ts';
import { type Identification, ProviderError } from '../_shared/vision.ts';
import { encodeBase64 } from 'jsr:@std/encoding@1/base64';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

declare const EdgeRuntime: { waitUntil?: (promise: Promise<unknown>) => void } | undefined;

const INTERNAL_HEADER = 'x-contabot-internal';

interface CaptureRow {
  id: string;
  task_id: string;
  status: string;
  stage: string | null;
  frames: StoredFrame[];
  selected_frame_ids: string[];
  primary_frame_id: string;
  identification: Identification | null;
}

/** true quando a plataforma manteve o trabalho rodando após a resposta. */
function runInBackground(promise: Promise<unknown>): boolean {
  if (typeof EdgeRuntime === 'undefined' || typeof EdgeRuntime?.waitUntil !== 'function') return false;
  EdgeRuntime.waitUntil(promise);
  return true;
}

function userMessage(error: unknown): string {
  if (error instanceof ProviderError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return 'Falha inesperada na análise.';
}

async function loadCapture(admin: SupabaseClient, id: string): Promise<CaptureRow | null> {
  const { data, error } = await admin
    .from('captures')
    .select('id, task_id, status, stage, frames, selected_frame_ids, primary_frame_id, identification')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data as CaptureRow | null;
}

async function loadCatalog(admin: SupabaseClient, taskId: string): Promise<CatalogEntry[]> {
  const { data, error } = await admin
    .from('task_items')
    .select('product_id, products!inner(id, name, variant, photos)')
    .eq('task_id', taskId);
  if (error) throw error;
  if (!data?.length) throw new ProviderError('Nenhum produto cadastrado para esta contagem.');
  // deno-lint-ignore no-explicit-any
  const catalog = (data as any[])
    .map((row) => row.products)
    .filter((p) => Array.isArray(p.photos) && p.photos.length > 0)
    .map((p) => ({ id: p.id, name: p.name, variant: p.variant ?? '', photos: p.photos as string[] }));
  if (!catalog.length) {
    throw new ProviderError('Os produtos desta área não possuem fotos de referência cadastradas.');
  }
  return catalog;
}

function imageLoader(admin: SupabaseClient) {
  const cache = new Map<string, Promise<VisionImage>>();
  return (path: string): Promise<VisionImage> => {
    if (!cache.has(path)) {
      cache.set(
        path,
        (async () => {
          const { data, error } = await admin.storage.from('media').download(path);
          if (error || !data) throw new ProviderError('Não foi possível ler uma imagem do vídeo ou do catálogo.');
          const mime = data.type && data.type.startsWith('image/') ? data.type : 'image/jpeg';
          return { dataUrl: `data:${mime};base64,${encodeBase64(new Uint8Array(await data.arrayBuffer()))}` };
        })(),
      );
    }
    return cache.get(path)!;
  };
}

async function toVisionSkus(catalog: CatalogEntry[], load: (path: string) => Promise<VisionImage>): Promise<VisionSku[]> {
  return await Promise.all(catalog.map(async (sku) => ({
    id: sku.id,
    name: sku.name,
    variant: sku.variant,
    photos: await Promise.all(sku.photos.map(load)),
  })));
}

async function toVisionFrames(frames: StoredFrame[], load: (path: string) => Promise<VisionImage>) {
  return await Promise.all(frames.map(async (f) => ({
    id: f.id,
    timestamp_seconds: f.timestamp_seconds,
    image: await load(f.path),
  })));
}

function identificationFrames(capture: CaptureRow): StoredFrame[] {
  const selected = new Set(capture.selected_frame_ids);
  return capture.frames
    .filter((f) => selected.has(f.id))
    .sort((a, b) => a.timestamp_seconds - b.timestamp_seconds);
}

async function rpc(admin: SupabaseClient, fn: string, args: Record<string, unknown>) {
  const { data, error } = await admin.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data;
}

async function triggerCounting(captureId: string) {
  const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/analyze-capture`;
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, [INTERNAL_HEADER]: key },
    body: JSON.stringify({ capture_id: captureId }),
  });
  if (!response.ok) throw new Error(`Não foi possível iniciar a etapa de contagem (HTTP ${response.status}).`);
}

async function runIdentification(admin: SupabaseClient, settings: VisionSettings, capture: CaptureRow) {
  const { provider } = settings;
  const catalog = await loadCatalog(admin, capture.task_id);
  const frames = identificationFrames(capture);
  const load = imageLoader(admin);
  const visionFrames = await toVisionFrames(frames, load);
  const video = { id: capture.id, primary_frame_id: capture.primary_frame_id };

  const parts: Identification[] = [];
  for (const batch of identificationBatches(catalog, frames.length, settings.maxImages)) {
    const result = await provider.identify(video, await toVisionSkus(batch, load), visionFrames);
    parts.push(result.prediction);
  }
  const identification = mergeIdentifications(capture.id, parts);
  const possible = possibleSkus(catalog, identification);

  if (!possible.length) {
    await rpc(admin, 'pipeline_finish', {
      p_capture_id: capture.id,
      p_result_frames: toResultFrames(frames),
      p_unknown_products: identification.unknown_products,
      p_items: noMatchItems(catalog, identification.matches),
      p_event: 'Análise concluída: nenhum produto identificado',
      p_model: provider.model,
      p_simulated: provider.simulated,
    });
    return;
  }

  const advanced = await rpc(admin, 'pipeline_set_stage', {
    p_capture_id: capture.id,
    p_stage: 'counting',
    p_identification: identification,
  });
  if (advanced) await triggerCounting(capture.id);
}

async function runCounting(admin: SupabaseClient, settings: VisionSettings, capture: CaptureRow) {
  const { provider } = settings;
  const identification = capture.identification;
  if (!identification) throw new Error('Identificação ausente para a etapa de contagem.');
  const catalog = await loadCatalog(admin, capture.task_id);
  const possible = possibleSkus(catalog, identification);
  const identFrames = identificationFrames(capture);
  const frames = countingFrames(
    capture.frames,
    identFrames,
    possible,
    identification,
    settings.maxImages,
    settings.maxCountFrames,
  );

  const load = imageLoader(admin);
  const result = await provider.count(
    { id: capture.id, primary_frame_id: capture.primary_frame_id, identification },
    await toVisionSkus(possible, load),
    await toVisionFrames(frames, load),
  );
  await rpc(admin, 'pipeline_finish', {
    p_capture_id: capture.id,
    p_result_frames: toResultFrames(frames),
    p_unknown_products: [...new Set([...identification.unknown_products, ...result.prediction.unknown_products])],
    p_items: countItems(catalog, identification, result.prediction, frames),
    p_event: 'Análise de vídeo concluída',
    p_model: result.model,
    p_usage: result.usage,
    p_simulated: result.simulated,
  });
}

async function process(admin: SupabaseClient, capture: CaptureRow) {
  try {
    const settings = visionSettingsFromEnv((name) => Deno.env.get(name));
    if (capture.stage === 'identifying') await runIdentification(admin, settings, capture);
    else if (capture.stage === 'counting') await runCounting(admin, settings, capture);
  } catch (error) {
    console.error(`analyze-capture ${capture.id} (${capture.stage}):`, error);
    await admin.rpc('pipeline_fail', { p_capture_id: capture.id, p_error: userMessage(error) });
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return fail(405, 'Use POST.');

  const body = await readJson(req);
  const captureId = String(body.capture_id ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(captureId)) return fail(422, 'Informe capture_id.');

  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const internal = serviceKey !== '' && req.headers.get(INTERNAL_HEADER) === serviceKey;
  if (!internal) {
    // O chamador precisa enxergar a captura pela RLS (mesma loja, perfil ativo).
    const token = bearerToken(req);
    if (!token) return fail(401, 'Sessão inválida ou expirada. Faça login novamente.');
    const { data, error } = await userClient(token).from('captures').select('id').eq('id', captureId).maybeSingle();
    if (error || !data) return fail(404, 'Captura não encontrada.');
  }

  const admin = adminClient();
  const capture = await loadCapture(admin, captureId);
  if (!capture) return fail(404, 'Captura não encontrada.');
  if (capture.status !== 'processing') return json({ status: capture.status }, 200);
  if (capture.stage !== 'identifying' && capture.stage !== 'counting') {
    return fail(409, 'Os quadros desta captura ainda não foram enviados.');
  }
  // Uma chamada externa só inicia a identificação; a contagem é sempre interna.
  if (!internal && capture.stage !== 'identifying') return json({ status: 'processing', stage: capture.stage }, 202);

  const { data: claimed, error: claimError } = await admin.rpc('pipeline_claim', {
    p_capture_id: capture.id,
    p_stage: capture.stage,
  });
  if (claimError) return fail(500, 'Não foi possível iniciar a análise.');
  if (!claimed) return json({ status: 'processing', stage: capture.stage }, 202);

  const job = process(admin, capture);
  if (!runInBackground(job)) await job;
  return json({ status: 'processing', stage: capture.stage }, 202);
});
