import { assert, assertEquals, assertRejects, assertThrows } from 'jsr:@std/assert@1';
import {
  boxFormatFor,
  dedupeBoxes,
  dedupeWithReport,
  iou,
  parseCountResult,
  parseIdentification,
  ProviderError,
  validateStage,
} from '../_shared/vision.ts';
import { ChatCompletionsProvider, MockProvider, parseModelJson, visionSettingsFromEnv } from '../_shared/providers.ts';
import {
  countItems,
  countingFrames,
  identificationBatches,
  identificationFrames,
  noMatchItems,
  overviewFrames,
} from '../_shared/analysis.ts';
import type { StoredFrame } from '../_shared/analysis.ts';

// deno-lint-ignore no-explicit-any
type Json = any;

/** Resposta da contagem como o modelo devolve: caixas, não um total. */
const suggestion = (boxes: Json[] = [[0, 0, 100, 100], [200, 0, 300, 100], [400, 0, 500, 100]]): Json => ({
  video_id: 'video-1',
  coverage_complete: true,
  overlap_resolved: true,
  unknown_products: [],
  counts: [{
    sku_id: 'sku-a',
    count_frame_id: 'frame-1',
    boxes,
    incomplete: false,
    needs_review: false,
    reason: '',
  }],
});
const validate = (payload: Json) => parseCountResult(payload, 'video-1', ['sku-a'], ['frame-1', 'frame-2']);

Deno.test('o servidor conta as caixas marcadas no frame de contagem', () => {
  const count = validate(suggestion()).counts[0];
  assertEquals(count.quantity, 3);
  assertEquals(count.evidence_frame_ids, ['frame-1']);
  assertEquals(count.marks?.marked, 3);
  assertEquals([count.incomplete, count.needs_review], [false, false]);
});

Deno.test('marcações repetidas da mesma unidade são descartadas', () => {
  const count = validate(suggestion([[0, 0, 100, 100], [5, 5, 102, 98], [300, 0, 400, 100]])).counts[0];
  assertEquals(count.quantity, 2);
  assertEquals(count.marks?.duplicates_removed, 1);
  // Unidades vizinhas encostadas não são duplicatas.
  assertEquals(dedupeBoxes([[0, 0, 100, 100], [100, 0, 200, 100], [50, 0, 150, 100]]).length, 3);
  assertEquals(iou([0, 0, 10, 10], [0, 0, 10, 10]), 1);
  assertEquals(iou([0, 0, 0, 0], [0, 0, 0, 0]), 1);
});

// Contagem real (Crocantinho, Mercadinho Walter): fileira de 8 unidades da frente para o fundo,
// em perspectiva. As 6 caixas que o servidor manteve com o limite antigo (0,5) e 2 intermediárias.
const perspectiveRow: Json[] = [
  [0, 495, 365, 930],
  [28, 476, 428, 883],
  [57, 457, 492, 836],
  [155, 411, 577, 686],
  [244, 372, 651, 670],
  [334, 333, 725, 655],
  [482, 280, 838, 608],
  [528, 255, 881, 431],
];

Deno.test('unidades vizinhas numa fileira em perspectiva não são descartadas como repetidas', () => {
  const count = validate(suggestion(perspectiveRow)).counts[0];
  assertEquals(count.quantity, 8);
  assertEquals(count.marks?.duplicates_removed, 0);
  assertEquals(count.needs_review, false);
  // O limite antigo (0,5) reproduz o erro de produção: 8 → 6.
  const old = dedupeWithReport(perspectiveRow, 0.5);
  assertEquals(old.kept.length, 6);
  assertEquals(old.discarded.map((d) => [d.iou, d.same_as]), [[0.685, 1], [0.571, 3]]);
});

Deno.test('caixa descartada fica registrada com IoU e a caixa repetida, e pede conferência', () => {
  const count = validate(suggestion([[0, 0, 100, 100], [300, 0, 400, 100], [302, 1, 401, 99]])).counts[0];
  assertEquals(count.quantity, 2);
  assertEquals(count.marks?.discarded, [{ box: [302, 1, 401, 99], iou: 0.951, same_as: 2 }]);
  assertEquals([count.incomplete, count.needs_review], [false, true]);
  assert(count.reason.length > 0);
  // Limite configurável: 0,96 mantém as três.
  const strict = parseCountResult(
    suggestion([[0, 0, 100, 100], [300, 0, 400, 100], [302, 1, 401, 99]]),
    'video-1',
    ['sku-a'],
    ['frame-1', 'frame-2'],
    'xyxy',
    0.96,
  );
  assertEquals(strict.counts[0].quantity, 3);
});

Deno.test('caixas fora da faixa ou invertidas são normalizadas; formatos inválidos falham', () => {
  const count = validate(suggestion([[-20, 1200, 300, 500]])).counts[0];
  assertEquals(count.marks?.boxes, [[0, 500, 300, 1000]]);
  for (const box of [[1, 2, 3], ['1', 2, 3, 4], [1, 2, 3, Infinity], 'caixa', null]) {
    assertThrows(() => validate(suggestion([box])), Error);
  }
  assertThrows(() => validate(suggestion(Array.from({ length: 301 }, () => [0, 0, 1, 1]))), Error, 'demais');
});

Deno.test('caixas do Gemini ([y_min, x_min, y_max, x_max]) são convertidas para x primeiro', () => {
  // Fileira horizontal: duas caixas lado a lado, na mesma altura.
  const gemini = suggestion([[300, 120, 620, 260], [305, 270, 625, 410]]);
  const yxyx = parseCountResult(gemini, 'video-1', ['sku-a'], ['frame-1', 'frame-2'], 'yxyx').counts[0];
  assertEquals(yxyx.marks?.boxes, [[120, 300, 260, 620], [270, 305, 410, 625]]);
  assertEquals(yxyx.quantity, 2);
  // Lido como xyxy, o mesmo par vira uma coluna vertical (o desenho transposto).
  assertEquals(validate(gemini).counts[0].marks?.boxes, [[300, 120, 620, 260], [305, 270, 625, 410]]);
  // Cantos invertidos continuam normalizados no formato yxyx.
  const flipped = parseCountResult(suggestion([[620, 260, 300, 120]]), 'video-1', ['sku-a'], ['frame-1'], 'yxyx');
  assertEquals(flipped.counts[0].marks?.boxes, [[120, 300, 260, 620]]);
});

Deno.test('formato das caixas segue o modelo e aceita sobreposição explícita', () => {
  assertEquals(boxFormatFor('google/gemini-3.7-flash'), 'yxyx');
  assertEquals(boxFormatFor('gemini-2.5-pro'), 'yxyx');
  assertEquals(boxFormatFor('Qwen/Qwen3-VL-235B-A22B-Instruct'), 'xyxy');
  assertEquals(boxFormatFor('gpt-5.6-luna'), 'xyxy');
  assertEquals(boxFormatFor('google/gemini-3.7-flash', 'xyxy'), 'xyxy');
  assertEquals(boxFormatFor('qwen', ' YXYX '), 'yxyx');
  assertEquals(boxFormatFor('qwen', 'invalido'), 'xyxy');
});

Deno.test('um SKU repetido é rejeitado em vez de somado', () => {
  const payload = suggestion();
  payload.counts.push(structuredClone(payload.counts[0]));
  assertThrows(() => validate(payload), Error, 'repetiu');
});

Deno.test('zero exige frame de contagem e visibilidade completa; senão vira desconhecido', () => {
  const zero = validate(suggestion([])).counts[0];
  assertEquals([zero.quantity, zero.evidence_frame_ids], [0, ['frame-1']]);
  const partial = suggestion([]);
  partial.coverage_complete = false;
  const unknown = validate(partial).counts[0];
  assertEquals([unknown.quantity, unknown.incomplete, unknown.needs_review, unknown.marks], [null, true, true, null]);
  assertEquals(unknown.evidence_frame_ids, []);
});

Deno.test('sem frame de contagem a quantidade é desconhecida, com revisão e motivo', () => {
  const payload = suggestion([]);
  payload.counts[0].count_frame_id = null;
  const count = validate(payload).counts[0];
  assertEquals([count.quantity, count.incomplete, count.needs_review], [null, true, true]);
  assert(count.reason.length > 0);
  // Caixas sem dizer em qual frame foram desenhadas não servem de evidência.
  payload.counts[0].boxes = [[0, 0, 10, 10]];
  assertThrows(() => validate(payload), Error, 'count_frame_id');
});

Deno.test('cobertura ou sobreposição pendente mantém a contagem visível, mas pede conferência', () => {
  for (const key of ['coverage_complete', 'overlap_resolved']) {
    const payload = suggestion();
    payload[key] = false;
    const count = validate(payload).counts[0];
    assertEquals([count.quantity, count.incomplete, count.needs_review], [3, true, true]);
  }
});

Deno.test('campos extras, SKUs e frames desconhecidos falham fechado', () => {
  const extra = suggestion();
  extra.confidence = 0.9;
  assertThrows(() => validate(extra));
  const legacy = suggestion();
  legacy.counts[0].quantity = 3;
  assertThrows(() => validate(legacy), Error, 'campos inesperados');
  const unknownSku = suggestion();
  unknownSku.counts[0].sku_id = 'sku-z';
  assertThrows(() => validate(unknownSku), Error, 'exatamente');
  const unknownFrame = suggestion();
  unknownFrame.counts[0].count_frame_id = 'frame-9';
  assertThrows(() => validate(unknownFrame), Error, 'não foi enviado');
  const legacyLayout = suggestion();
  Object.assign(legacyLayout.counts[0], { facings: 2, depth: 3, depth_frame_id: 'frame-2' });
  assertThrows(() => validate(legacyLayout), Error, 'campos inesperados');
});

Deno.test('produtos fora do catálogo não invalidam a contagem', () => {
  const payload = suggestion();
  payload.unknown_products = ['Alfajor na fileira ao lado'];
  const result = validate(payload);
  assertEquals(result.counts[0].quantity, 3);
  assertEquals(result.unknown_products.length, 1);
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

Deno.test('validateStage converte violações em ProviderError e preserva a causa interna', () => {
  const err = assertThrows(() => validateStage('count', {}, 'v', ['s'], ['f']), ProviderError, 'viola o esquema');
  assert(err.cause instanceof Error);
  assert(err.cause.message.includes('CountResult'));
});

Deno.test('chat instrui a não ecoar o JSON Schema e faz 1 retry corretivo quando o modelo devolve o próprio schema', async () => {
  const captured: Json[] = [];
  const echoedSchema = {
    type: 'object',
    additionalProperties: false,
    properties: { video_id: { type: 'string' } },
    required: ['video_id', 'matches', 'unknown_products'],
  };
  const validAnswer = {
    video_id: 'video-1',
    matches: [{ sku_id: 'sku-a', status: 'present', reason: 'Visível.', evidence_frame_ids: ['frame-2'] }],
    unknown_products: [],
  };
  const responses = [echoedSchema, validAnswer];
  const seqFetch = ((_url: string, req: RequestInit) => {
    captured.push(JSON.parse(String(req.body)));
    const next = responses.shift() ?? echoedSchema;
    const body = {
      id: `req-${captured.length}`,
      model: 'modelo-x',
      usage: { prompt_tokens: 10, completion_tokens: 20 },
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(next) } }],
    };
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  }) as typeof fetch;

  const result = await chat(seqFetch).identify(video, catalog, frames);
  assertEquals(result.prediction.matches[0].status, 'present');
  assertEquals(captured.length, 2);
  // O system prompt deve conter exemplo concreto e proibição de devolver as chaves do JSON Schema
  assert(captured[0].messages[0].content.includes('NUNCA retorne a definição do esquema'));
  // A 2ª tentativa deve incluir a resposta incorreta e o erro específico de validação para autocorreção
  assertEquals(captured[1].messages.length, 4);
  assertEquals(captured[1].messages[2].role, 'assistant');
  assertEquals(captured[1].messages[3].role, 'user');
  assert(captured[1].messages[3].content.includes('campos inesperados'));

  // Se continuar inválido na 2ª tentativa, falha fechado após o único retry (2 chamadas no total)
  const alwaysBadCalls: Json[] = [];
  const alwaysBadFetch = ((_url: string, req: RequestInit) => {
    alwaysBadCalls.push(JSON.parse(String(req.body)));
    return Promise.resolve(
      new Response(
        JSON.stringify({
          id: 'req-bad',
          model: 'modelo-x',
          usage: {},
          choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(echoedSchema) } }],
        }),
        { status: 200 },
      ),
    );
  }) as typeof fetch;
  await assertRejects(() => chat(alwaysBadFetch).identify(video, catalog, frames), ProviderError, 'viola o esquema');
  assertEquals(alwaysBadCalls.length, 2);
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
  assertEquals(body.max_tokens, 8000);
  assertEquals(body.response_format.json_schema.name, 'identify');
  const texts = body.messages[1].content.filter((p: Json) => p.type === 'text').map((p: Json) => p.text);
  assert(texts[1].startsWith('Frame PRINCIPAL; evidence_frame_id=frame-2'));
  assert(texts[3].startsWith('REFERÊNCIA SKU=sku-a'));
  assert(body.messages[0].content.includes('ETAPA: IDENTIFICAR'));
});

Deno.test('chat na contagem pede marcações e devolve a quantidade calculada pelo servidor', async () => {
  const captured: Json[] = [];
  const answer = {
    video_id: 'video-1',
    coverage_complete: true,
    overlap_resolved: true,
    unknown_products: [],
    counts: [{
      sku_id: 'sku-a',
      count_frame_id: 'frame-2',
      boxes: [[0, 0, 100, 100], [150, 0, 250, 100]],
      incomplete: false,
      needs_review: false,
      reason: 'Duas caixas na frente.',
    }],
  };
  const result = await chat(fakeFetch(answer, { captured })).count(video, catalog, frames);
  assertEquals(result.prediction.counts[0].quantity, 2);
  assertEquals(result.prediction.counts[0].marks?.boxes.length, 2);
  const body = captured[0];
  assertEquals(body.response_format.json_schema.name, 'count');
  const system = body.messages[0].content;
  assert(system.includes('ETAPA: CONTAR'));
  assert(system.includes('[x_min, y_min, x_max, y_max]'));
  assert(system.includes('"boxes"'), 'exemplo de resposta com caixas');
  assert(!system.includes('"quantity"'), 'o modelo não informa total');
});

Deno.test('chat com Gemini pede y primeiro e grava as caixas com x primeiro', async () => {
  const captured: Json[] = [];
  const answer = {
    video_id: 'video-1',
    coverage_complete: true,
    overlap_resolved: true,
    unknown_products: [],
    counts: [{
      sku_id: 'sku-a',
      count_frame_id: 'frame-2',
      boxes: [[300, 120, 620, 260], [305, 270, 625, 410]],
      incomplete: false,
      needs_review: false,
      reason: 'Duas caixas lado a lado.',
    }],
  };
  const gemini = chat(fakeFetch(answer, { captured }), { model: 'google/gemini-3.7-flash' });
  const result = await gemini.count(video, catalog, frames);
  assertEquals(result.prediction.counts[0].marks?.boxes, [[120, 300, 260, 620], [270, 305, 410, 625]]);
  const system = captured[0].messages[0].content;
  assert(system.includes('[y_min, x_min, y_max, x_max]'));
  assert(!system.includes('[x_min, y_min, x_max, y_max]'));
  assert(system.includes('[[300,120,620,260],[305,270,625,410]]'), 'exemplo no mesmo formato');

  const forced = [] as Json[];
  await chat(fakeFetch(answer, { captured: forced }), { model: 'google/gemini-3.7-flash', boxFormat: 'xyxy' })
    .count(video, catalog, frames);
  assert(forced[0].messages[0].content.includes('[x_min, y_min, x_max, y_max]'));
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
  const defaults = visionSettingsFromEnv(env({ VISION_PROVIDER: 'mock' }));
  assertEquals([defaults.maxImages, defaults.maxIdentifyFrames, defaults.maxCountFrames], [32, 20, 10]);
  assertEquals(visionSettingsFromEnv(env({ VISION_PROVIDER: 'mock', VISION_MAX_IDENTIFY_FRAMES: '8' })).maxIdentifyFrames, 8);
  const chatEnv = {
    VISION_API_URL: 'https://api.exemplo.com/v1/chat/completions',
    VISION_MODEL: 'google/gemini-3.7-flash',
    VISION_API_KEY: 'k',
  };
  visionSettingsFromEnv(env({ ...chatEnv, VISION_BOX_FORMAT: 'yxyx' }));
  assertThrows(() => visionSettingsFromEnv(env({ ...chatEnv, VISION_BOX_FORMAT: 'xy' })), ProviderError, 'VISION_BOX_FORMAT');
  visionSettingsFromEnv(env({ ...chatEnv, VISION_DUPLICATE_IOU: '0,9' }));
  for (const bad of ['0.3', '1', 'abc']) {
    assertThrows(() => visionSettingsFromEnv(env({ ...chatEnv, VISION_DUPLICATE_IOU: bad })), ProviderError, 'VISION_DUPLICATE_IOU');
  }
});

Deno.test('mock é determinístico nas duas etapas', async () => {
  const mock = new MockProvider();
  const many = [0, 1, 2].map((i) => ({ id: `sku-${i}`, name: `P${i}`, variant: '', photos: [image] }));
  const ident = await mock.identify(video, many, frames);
  assertEquals(ident.prediction.matches.map((m) => m.status), ['present', 'present', 'absent']);
  const count = await mock.count(video, many, frames);
  assertEquals(count.prediction.counts.map((c) => c.quantity), [3, 4, 5]);
  assertEquals(count.prediction.counts.map((c) => c.marks?.boxes.length), [3, 4, 5]);
  assertEquals(count.prediction.counts.map((c) => c.marks?.frame_id), ['frame-2', 'frame-2', 'frame-2']);
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

Deno.test('identificação usa todos os quadros enviados quando cabem com o catálogo', () => {
  const pool = Array.from({ length: 20 }, (_, i) => stored(`f${String(i + 1).padStart(4, '0')}`, i, i));
  const selected = ['f0001', 'f0006', 'f0011', 'f0016', 'f0020'];
  const skus = [1, 2, 3].map((i) => ({ id: `s${i}`, name: '', variant: '', photos: ['a', 'b'] }));
  assertEquals(identificationFrames(pool, selected, skus, 32, 20).length, 20);
  assertEquals(identificationFrames(pool, selected, skus, 32, 8).length, 8);
  // 16 imagens − 6 fotos = 10 quadros, sempre com os de visão geral e espalhados no tempo.
  const ten = identificationFrames(pool, selected, skus, 16, 20);
  assertEquals(ten.length, 10);
  for (const id of selected) assert(ten.some((f) => f.id === id), `mantém ${id}`);
  const times = ten.map((f) => f.timestamp_seconds);
  assertEquals(times, [...times].sort((a, b) => a - b));
  assert(Math.max(...times.slice(1).map((t, i) => t - times[i])) <= 3, 'sem buracos grandes no tempo');
  // Catálogo grande: volta aos quadros de visão geral e o catálogo vai em lotes.
  const big = Array.from({ length: 14 }, (_, i) => ({ id: `b${i}`, name: '', variant: '', photos: ['a'] }));
  assertEquals(identificationFrames(pool, selected, big, 16, 20).map((f) => f.id), selected);
  assertEquals(overviewFrames(pool, selected).map((f) => f.id), selected);
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

Deno.test('itens: ok e check com sugestão já chegam preenchidos; ausência fica sem quantidade', () => {
  const frames = [{ ...stored('f0001', 0, 1), width: 1024, height: 576 }, stored('f0002', 2, 2)];
  const skus = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, name: id, variant: '', photos: ['p'] }));
  const identification = {
    video_id: 'cap',
    matches: skus.map((s) => ({ sku_id: s.id, status: 'present' as const, reason: `motivo ${s.id}`, evidence_frame_ids: ['f0001'] })),
    unknown_products: [],
  };
  const row = (sku: string, boxes: Json[], extra: Json = {}) => ({
    sku_id: sku,
    count_frame_id: 'f0001',
    boxes,
    incomplete: false,
    needs_review: false,
    reason: '',
    ...extra,
  });
  const box = (i: number) => [i * 100, 0, i * 100 + 90, 100];
  const result = parseCountResult({
    video_id: 'cap',
    coverage_complete: true,
    overlap_resolved: true,
    unknown_products: [],
    counts: [
      row('a', [0, 1, 2, 3, 4].map(box), { reason: 'nítido' }),
      row('b', [box(0), box(1)], { needs_review: true, reason: 'confira' }),
      row('c', [], { count_frame_id: null, incomplete: true, needs_review: true, reason: 'oculto' }),
    ],
  }, 'cap', ['a', 'b', 'c'], ['f0001', 'f0002']);
  const items = countItems(skus, identification, result, frames);
  assertEquals(
    items.map((i) => [i.ai_status, i.counted]),
    [['ok', 5], ['check', 2], ['missing', null], ['missing', null], ['missing', null]],
  );
  assertEquals(items[0].evidence_frame, 'loja/captures/cap/f0001.jpg');
  assertEquals(items[0].ai_note, '5 unidades marcadas na imagem. nítido');
  assertEquals(items[0].ai_marks?.frame, 'loja/captures/cap/f0001.jpg');
  assertEquals([items[0].ai_marks?.width, items[0].ai_marks?.height], [1024, 576]);
  assertEquals(items[0].ai_marks?.boxes.length, 5);
  assertEquals(items[2].ai_marks, null);
  assertEquals(items[3].ai_note, 'motivo d');
  assertEquals(items[1].ai_note, '2 unidades marcadas na imagem. confira');
  assertEquals(items[0].ai_marks?.discarded, []);
  const repeated = countItems(skus, identification, parseCountResult({
    video_id: 'cap',
    coverage_complete: true,
    overlap_resolved: true,
    unknown_products: [],
    counts: [row('a', [box(0), box(1), [101, 1, 189, 99]], { reason: 'nítido' })],
  }, 'cap', ['a'], ['f0001', 'f0002']), frames)[0];
  assertEquals([repeated.ai_status, repeated.counted], ['check', 2]);
  assertEquals(repeated.ai_marks?.discarded.map((d) => d.same_as), [2]);
  assertEquals(
    repeated.ai_note,
    '2 unidades marcadas na imagem (1 marcação descartada por quase coincidir com outra; confira se não era uma unidade a mais). nítido',
  );
  assertEquals(noMatchItems(skus, []).every((i) => i.ai_status === 'missing' && i.ai_marks === null), true);
});

Deno.test('notas longas da IA não são cortadas em 300 caracteres em countItems nem noMatchItems', () => {
  const frames = [stored('f0001', 0, 1)];
  const skus = ['a', 'b'].map((id) => ({ id, name: id, variant: '', photos: ['p'] }));
  const longCountReason =
    'Contagem visível parcial no frame f0001: quatro unidades físicas identificadas com nitidez na prateleira superior, ' +
    'incluindo marca, variante e peso de 500 g compatíveis com a foto de referência enviada no catálogo oficial da loja. ' +
    'No entanto, há várias caixas parcialmente encobertas atrás da fileira frontal e a varredura curta não mostra a lateral direita completa, ' +
    'impedindo afirmar o total do estoque sem conferência manual cuidadosa.';
  const longMissReason =
    'Os produtos observados nos quadros enviados pertencem a outra marca e outra embalagem (sachês azuis e brancos de açúcar 5 g), ' +
    'não correspondendo ao item cadastrado na referência com frasco vermelho e tampa preta de 500 ml, embora compartilhem a mesma gôndola ' +
    'próxima ao balcão principal durante toda a gravação contínua que foi enviada e analisada pela inteligência artificial.';
  assert(longCountReason.length > 350);
  assert(longMissReason.length > 350);

  const identification = {
    video_id: 'cap',
    matches: [
      { sku_id: 'a', status: 'present' as const, reason: 'ok', evidence_frame_ids: ['f0001'] },
      { sku_id: 'b', status: 'absent' as const, reason: longMissReason, evidence_frame_ids: [] },
    ],
    unknown_products: [],
  };
  const result = {
    video_id: 'cap',
    coverage_complete: false,
    overlap_resolved: true,
    unknown_products: [],
    counts: [
      {
        sku_id: 'a',
        quantity: 4,
        incomplete: true,
        needs_review: true,
        reason: longCountReason,
        evidence_frame_ids: ['f0001'],
        marks: null,
      },
    ],
  };

  const counted = countItems(skus, identification, result, frames);
  assertEquals(counted[0].ai_note, longCountReason);
  assertEquals(counted[1].ai_note, longMissReason);

  const missed = noMatchItems([skus[1]], [identification.matches[1]]);
  assertEquals(missed[0].ai_note, longMissReason);
});
