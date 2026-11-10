import { assert, assertEquals, assertRejects, assertThrows } from 'jsr:@std/assert@1';
import { parseCountResult, parseIdentification, ProviderError, validateStage } from '../_shared/vision.ts';
import { ChatCompletionsProvider, MockProvider, parseModelJson, visionSettingsFromEnv } from '../_shared/providers.ts';
import { countItems, countingFrames, identificationBatches, noMatchItems } from '../_shared/analysis.ts';
import type { StoredFrame } from '../_shared/analysis.ts';

// deno-lint-ignore no-explicit-any
type Json = any;

const suggestion = (quantity: unknown = 3): Json => ({
  video_id: 'video-1',
  coverage_complete: true,
  overlap_resolved: true,
  unknown_products: [],
  counts: [{
    sku_id: 'sku-a',
    quantity,
    incomplete: false,
    needs_review: false,
    reason: '',
    evidence_frame_ids: ['frame-1', 'frame-2'],
  }],
});
const validate = (payload: Json) => parseCountResult(payload, 'video-1', ['sku-a'], ['frame-1', 'frame-2']);

Deno.test('quantidade exige inteiro não negativo estrito', () => {
  for (const q of [-1, 1.5, '3', true, false]) assertThrows(() => validate(suggestion(q)));
  assertEquals(validate(suggestion(3)).counts[0].quantity, 3);
});

Deno.test('um SKU repetido é rejeitado em vez de somado', () => {
  const payload = suggestion(3);
  payload.counts.push(structuredClone(payload.counts[0]));
  assertThrows(() => validate(payload), Error, 'repetiu');
});

Deno.test('zero exige visibilidade completa e evidência', () => {
  assertEquals(validate(suggestion(0)).counts[0].quantity, 0);
  const noEvidence = suggestion(0);
  noEvidence.counts[0].evidence_frame_ids = [];
  assertThrows(() => validate(noEvidence), Error, 'evidência');
  const partial = suggestion(0);
  partial.coverage_complete = false;
  Object.assign(partial.counts[0], { incomplete: true, needs_review: true, reason: 'Área cortada.' });
  assertThrows(() => validate(partial), Error, 'não zero');
});

Deno.test('quantidade desconhecida não vira zero', () => {
  const payload = suggestion(null);
  assertThrows(() => validate(payload));
  payload.coverage_complete = false;
  Object.assign(payload.counts[0], { incomplete: true, needs_review: true, reason: 'Caixas ocultas.' });
  assertEquals(validate(payload).counts[0].quantity, null);
});

Deno.test('sobreposição não resolvida só aceita contagem de um único quadro', () => {
  const payload = suggestion(4);
  payload.overlap_resolved = false;
  Object.assign(payload.counts[0], { incomplete: true, needs_review: true, reason: 'Parcial.' });
  assertThrows(() => validate(payload), Error, 'único frame');
  payload.counts[0].evidence_frame_ids = ['frame-2'];
  assertEquals(validate(payload).counts[0].quantity, 4);
});

Deno.test('campos extras e SKUs desconhecidos falham fechado', () => {
  const extra = suggestion(3);
  extra.confidence = 0.9;
  assertThrows(() => validate(extra));
  const unknownSku = suggestion(3);
  unknownSku.counts[0].sku_id = 'sku-z';
  assertThrows(() => validate(unknownSku), Error, 'exatamente');
  const unknownFrame = suggestion(3);
  unknownFrame.counts[0].evidence_frame_ids = ['frame-9'];
  assertThrows(() => validate(unknownFrame), Error, 'não foi enviado');
});

Deno.test('produtos desconhecidos exigem revisão', () => {
  const payload = suggestion(3);
  payload.unknown_products = ['Caixa azul sem rótulo'];
  assertThrows(() => validate(payload), Error, 'revisão');
  Object.assign(payload.counts[0], { needs_review: true, reason: 'Produto desconhecido ao lado.' });
  assertEquals(validate(payload).unknown_products.length, 1);
});

Deno.test('identificação exige todos os SKUs, motivo e evidência para present', () => {
  const ok = {
    video_id: 'video-1',
    matches: [{ sku_id: 'sku-a', status: 'present', reason: 'Rótulo visível.', evidence_frame_ids: ['frame-1'] }],
    unknown_products: [],
  };
  assertEquals(parseIdentification(ok, 'video-1', ['sku-a'], ['frame-1']).matches.length, 1);
  assertThrows(() => parseIdentification(ok, 'video-1', ['sku-a', 'sku-b'], ['frame-1']), Error, 'exatamente');
  const noReason = structuredClone(ok);
  noReason.matches[0].reason = ' ';
  assertThrows(() => parseIdentification(noReason, 'video-1', ['sku-a'], ['frame-1']), Error, 'motivo');
  const noEvidence = structuredClone(ok);
  noEvidence.matches[0].evidence_frame_ids = [];
  assertThrows(() => parseIdentification(noEvidence, 'video-1', ['sku-a'], ['frame-1']), Error, 'evidência');
});

Deno.test('validateStage converte violações em ProviderError', () => {
  assertThrows(() => validateStage('count', {}, 'v', ['s'], ['f']), ProviderError, 'viola o esquema');
});

// ---------------------------------------------------------------------------
// Provedor Chat Completions
// ---------------------------------------------------------------------------

const image = { dataUrl: 'data:image/jpeg;base64,AAAA' };
const video = { id: 'video-1', primary_frame_id: 'frame-2' };
const catalog = [{ id: 'sku-a', name: 'Chocolate', variant: '90 g', photos: [image] }];
const frames = [
  { id: 'frame-1', timestamp_seconds: 0, image },
  { id: 'frame-2', timestamp_seconds: 2, image },
];

function fakeFetch(content: unknown, init: { status?: number; finish?: string; captured?: Json[] } = {}) {
  return ((_url: string, req: RequestInit) => {
    init.captured?.push(JSON.parse(String(req.body)));
    const body = {
      id: 'req-1',
      model: 'modelo-x',
      usage: { prompt_tokens: 10 },
      choices: [{ finish_reason: init.finish ?? 'stop', message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }],
    };
    return Promise.resolve(new Response(JSON.stringify(body), { status: init.status ?? 200 }));
  }) as typeof fetch;
}

const chat = (fetchImpl: typeof fetch, extra: Record<string, unknown> = {}) =>
  new ChatCompletionsProvider({
    endpoint: 'https://api.exemplo.com/v1/chat/completions',
    model: 'modelo-x',
    apiKey: 'segredo',
    fetchImpl,
    ...extra,
  });

Deno.test('chat envia principal primeiro, referências depois, e o esquema da etapa', async () => {
  const captured: Json[] = [];
  const answer = {
    video_id: 'video-1',
    matches: [{ sku_id: 'sku-a', status: 'present', reason: 'Visível.', evidence_frame_ids: ['frame-2'] }],
    unknown_products: [],
  };
  const result = await chat(fakeFetch(answer, { captured })).identify(video, catalog, frames);
  assertEquals(result.prediction.matches[0].status, 'present');
  assertEquals(result.model, 'modelo-x');
  const body = captured[0];
  assertEquals(body.max_tokens, 4000);
  assertEquals(body.response_format.json_schema.name, 'identify');
  const texts = body.messages[1].content.filter((p: Json) => p.type === 'text').map((p: Json) => p.text);
  assert(texts[1].startsWith('Frame PRINCIPAL; evidence_frame_id=frame-2'));
  assert(texts[3].startsWith('REFERÊNCIA SKU=sku-a'));
  assert(body.messages[0].content.includes('ETAPA: IDENTIFICAR'));
});

Deno.test('chat aceita cercas de markdown e remove <think>', () => {
  assertEquals(parseModelJson('<think>x</think>\n```json\n{"a":1}\n```'), { a: 1 });
  assertEquals(parseModelJson('não é json'), undefined);
});

Deno.test('chat falha fechado em truncamento, recusa e HTTP de erro', async () => {
  await assertRejects(() => chat(fakeFetch('{}', { finish: 'length' })).count(video, catalog, frames), ProviderError, 'truncada');
  await assertRejects(() => chat(fakeFetch('{}', { finish: 'content_filter' })).count(video, catalog, frames), ProviderError, 'recusou');
  await assertRejects(() => chat(fakeFetch('{}', { status: 401 })).count(video, catalog, frames), ProviderError, 'HTTP 401');
  await assertRejects(() => chat(fakeFetch('{}', { status: 413 })).count(video, catalog, frames), ProviderError, '413');
});

Deno.test('chat não vaza o segredo em erro de conexão', async () => {
  const broken = (() => Promise.reject(new TypeError('segredo na mensagem'))) as typeof fetch;
  const error = await assertRejects(() => chat(broken).count(video, catalog, frames), ProviderError);
  assert(!error.message.includes('segredo'));
});

Deno.test('chat respeita limite de imagens antes de chamar a API', async () => {
  let called = false;
  const spy = (() => {
    called = true;
    return Promise.resolve(new Response('{}'));
  }) as typeof fetch;
  await assertRejects(() => chat(spy, { maxImages: 2 }).count(video, catalog, frames), ProviderError, 'limite');
  assert(!called);
});

Deno.test('chat exige configuração e protege parâmetros do contrato', () => {
  assertThrows(() => new ChatCompletionsProvider({ endpoint: '', model: 'm', apiKey: 'k' }), ProviderError, 'VISION_API_URL');
  assertThrows(() => new ChatCompletionsProvider({ endpoint: 'https://x.com/v1', model: '', apiKey: 'k' }), ProviderError, 'VISION_MODEL');
  assertThrows(() => new ChatCompletionsProvider({ endpoint: 'https://x.com/v1', model: 'm', apiKey: '' }), ProviderError, 'VISION_API_KEY');
  new ChatCompletionsProvider({ endpoint: 'http://localhost:11434/v1/chat/completions', model: 'm', apiKey: '' });
  for (const param of ['model', 'messages', 'response_format', 'max_tokens', 'stream']) {
    assertThrows(
      () => new ChatCompletionsProvider({ endpoint: 'https://x.com/v1', model: 'm', apiKey: 'k', extraParameters: { [param]: 1 } }),
      ProviderError,
      'Parâmetros extras',
    );
  }
});

Deno.test('configuração por ambiente: chat é o padrão e mock é explícito', () => {
  const env = (values: Record<string, string>) => (name: string) => values[name];
  assertThrows(() => visionSettingsFromEnv(env({})), ProviderError, 'VISION_API_URL');
  assertThrows(() => visionSettingsFromEnv(env({ VISION_PROVIDER: 'codex' })), ProviderError, 'chat ou mock');
  assertEquals(visionSettingsFromEnv(env({ VISION_PROVIDER: 'mock' })).provider.simulated, true);
  const configured = visionSettingsFromEnv(env({
    VISION_API_URL: 'https://api.exemplo.com/v1/chat/completions',
    VISION_MODEL: 'modelo-x',
    VISION_API_KEY: 'k',
    VISION_MAX_IMAGES: '12',
    VISION_TOKEN_LIMIT_PARAM: 'max_completion_tokens',
  }));
  assertEquals(configured.provider.name, 'chat');
  assertEquals(configured.maxImages, 12);
});

Deno.test('mock é determinístico nas duas etapas', async () => {
  const mock = new MockProvider();
  const many = [0, 1, 2].map((i) => ({ id: `sku-${i}`, name: `P${i}`, variant: '', photos: [image] }));
  const ident = await mock.identify(video, many, frames);
  assertEquals(ident.prediction.matches.map((m) => m.status), ['present', 'present', 'absent']);
  const count = await mock.count(video, many, frames);
  assertEquals(count.prediction.counts.map((c) => c.quantity), [3, 4, 5]);
  validateStage('count', count.prediction, video.id, many.map((s) => s.id), frames.map((f) => f.id));
});

// ---------------------------------------------------------------------------
// Planejamento do pipeline
// ---------------------------------------------------------------------------

const fp = (n: number) => ({ thumb: n.toString(16).padStart(2, '0').repeat(32 * 18 * 3), dhash: '0'.repeat(16) });
const stored = (id: string, t: number, n: number): StoredFrame => ({
  id,
  timestamp_seconds: t,
  path: `loja/captures/cap/${id}.jpg`,
  metrics: { sharpness: 0, exposure: 0, motion: 0, glare: 0, quality: 0.5 },
  warnings: [],
  fingerprint: fp(n),
});

Deno.test('lotes de identificação respeitam o limite de imagens', () => {
  const skus = [1, 2, 3].map((i) => ({ id: `s${i}`, name: '', variant: '', photos: ['a', 'b'] }));
  assertEquals(identificationBatches(skus, 5, 9).map((b) => b.length), [2, 1]);
  assertThrows(() => identificationBatches(skus, 5, 6), ProviderError, 'fotos de referência demais');
});

Deno.test('quadros de contagem somam identificação e vizinhos das evidências', () => {
  const pool = [0, 2, 4, 6, 8, 10].map((t, i) => stored(`f000${i + 1}`, t, i * 40));
  const ident = [pool[0], pool[3]];
  const skus = [{ id: 's1', name: '', variant: '', photos: ['p'] }];
  const identification = {
    video_id: 'cap',
    matches: [{ sku_id: 's1', status: 'present' as const, reason: 'ok', evidence_frame_ids: ['f0004'] }],
    unknown_products: [],
  };
  const frames = countingFrames(pool, ident, skus, identification, 16, 4);
  assertEquals(frames.map((f) => f.timestamp_seconds), [0, 4, 6, 8]);
  assertThrows(() => countingFrames(pool, ident, skus, identification, 2, 4), ProviderError, 'Produtos demais');
});

Deno.test('itens: ok chega preenchido, dúvida e ausência ficam para conferência', () => {
  const frames = [stored('f0001', 0, 1)];
  const skus = ['a', 'b', 'c', 'd'].map((id) => ({ id, name: id, variant: '', photos: ['p'] }));
  const identification = {
    video_id: 'cap',
    matches: skus.map((s) => ({ sku_id: s.id, status: 'present' as const, reason: `motivo ${s.id}`, evidence_frame_ids: ['f0001'] })),
    unknown_products: [],
  };
  const result = {
    video_id: 'cap',
    coverage_complete: true,
    overlap_resolved: true,
    unknown_products: [],
    counts: [
      { sku_id: 'a', quantity: 5, incomplete: false, needs_review: false, reason: 'nítido', evidence_frame_ids: ['f0001'] },
      { sku_id: 'b', quantity: 2, incomplete: false, needs_review: true, reason: 'confira', evidence_frame_ids: ['f0001'] },
      { sku_id: 'c', quantity: null, incomplete: true, needs_review: true, reason: 'oculto', evidence_frame_ids: [] },
    ],
  };
  const items = countItems(skus, identification, result, frames);
  assertEquals(items.map((i) => [i.ai_status, i.counted]), [['ok', 5], ['check', null], ['missing', null], ['missing', null]]);
  assertEquals(items[0].evidence_frame, 'loja/captures/cap/f0001.jpg');
  assertEquals(items[3].ai_note, 'motivo d');
  assertEquals(noMatchItems(skus, []).every((i) => i.ai_status === 'missing'), true);
});
