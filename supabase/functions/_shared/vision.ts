/**
 * Contrato das duas etapas de visão (identificar → contar): esquemas JSON e
 * validação estrita das respostas, portados do antigo backend Python (domain.py).
 */

export type Stage = 'identify' | 'count';

export class ProviderError extends Error {
  usage: Record<string, unknown>;
  requestId: string | null;
  constructor(
    message: string,
    opts: { usage?: Record<string, unknown>; requestId?: string | null; cause?: unknown } = {},
  ) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = 'ProviderError';
    this.usage = opts.usage ?? {};
    this.requestId = opts.requestId ?? null;
  }
}

export interface SkuMatch {
  sku_id: string;
  status: 'present' | 'absent' | 'uncertain';
  evidence_frame_ids: string[];
  reason: string;
}

export interface Identification {
  video_id: string;
  matches: SkuMatch[];
  unknown_products: string[];
}

/** Caixa de uma unidade física, normalizada 0–1000: [x_min, y_min, x_max, y_max]. */
export type Box = [number, number, number, number];

/** Linha da contagem como o modelo devolve: marcações, não um total. */
export interface RawSkuCount {
  sku_id: string;
  /** Único quadro em que as unidades foram marcadas (null = nenhum permite distinguir). */
  count_frame_id: string | null;
  /** Uma caixa por unidade física do SKU visível em count_frame_id. */
  boxes: Box[];
  /** Frentes (colunas) do produto na vista frontal, para a estimativa por arranjo. */
  facings: number | null;
  /** Unidades por fileira, da frente para o fundo, vistas em depth_frame_id. */
  depth: number | null;
  depth_frame_id: string | null;
  incomplete: boolean;
  needs_review: boolean;
  reason: string;
}

export interface RawCountResult {
  video_id: string;
  coverage_complete: boolean;
  overlap_resolved: boolean;
  counts: RawSkuCount[];
  unknown_products: string[];
}

/** Como o servidor chegou à quantidade (mostrado na conferência). */
export interface CountMarks {
  frame_id: string;
  /** Caixas que sobraram após remover marcações repetidas. */
  boxes: Box[];
  marked: number;
  duplicates_removed: number;
  facings: number | null;
  depth: number | null;
  depth_frame_id: string | null;
  /** marked = número de caixas; layout = frentes × profundidade. */
  method: 'marked' | 'layout';
}

/** Contagem consolidada pelo servidor a partir das marcações do modelo. */
export interface SkuCount {
  sku_id: string;
  quantity: number | null;
  incomplete: boolean;
  needs_review: boolean;
  reason: string;
  evidence_frame_ids: string[];
  marks: CountMarks | null;
}

export interface CountResult {
  video_id: string;
  coverage_complete: boolean;
  overlap_resolved: boolean;
  counts: SkuCount[];
  unknown_products: string[];
}

const stringArray = { type: 'array', items: { type: 'string' } };
const nullableString = { anyOf: [{ type: 'string' }, { type: 'null' }] };
const nullableInteger = { anyOf: [{ type: 'integer' }, { type: 'null' }] };

export const SCHEMAS: Record<Stage, Record<string, unknown>> = {
  identify: {
    type: 'object',
    additionalProperties: false,
    properties: {
      video_id: { type: 'string' },
      matches: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            sku_id: { type: 'string' },
            status: { type: 'string', enum: ['present', 'absent', 'uncertain'] },
            evidence_frame_ids: stringArray,
            reason: { type: 'string' },
          },
          required: ['sku_id', 'status', 'evidence_frame_ids', 'reason'],
        },
      },
      unknown_products: stringArray,
    },
    required: ['video_id', 'matches', 'unknown_products'],
  },
  count: {
    type: 'object',
    additionalProperties: false,
    properties: {
      video_id: { type: 'string' },
      coverage_complete: { type: 'boolean' },
      overlap_resolved: { type: 'boolean' },
      counts: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            sku_id: { type: 'string' },
            count_frame_id: nullableString,
            boxes: { type: 'array', items: { type: 'array', items: { type: 'integer' } } },
            facings: nullableInteger,
            depth: nullableInteger,
            depth_frame_id: nullableString,
            incomplete: { type: 'boolean' },
            needs_review: { type: 'boolean' },
            reason: { type: 'string' },
          },
          required: [
            'sku_id',
            'count_frame_id',
            'boxes',
            'facings',
            'depth',
            'depth_frame_id',
            'incomplete',
            'needs_review',
            'reason',
          ],
        },
      },
      unknown_products: stringArray,
    },
    required: ['video_id', 'coverage_complete', 'overlap_resolved', 'counts', 'unknown_products'],
  },
};

// ---------------------------------------------------------------------------
// Validação estrita (sem coerção de tipos, sem campos extras)
// ---------------------------------------------------------------------------

class SchemaError extends Error {}

function exactObject(value: unknown, keys: string[], where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SchemaError(`${where}: esperado objeto.`);
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record);
  const extra = actual.filter((k) => !keys.includes(k));
  const missing = keys.filter((k) => !(k in record));
  if (extra.length || missing.length) {
    throw new SchemaError(`${where}: campos inesperados ${extra.join(',')} / ausentes ${missing.join(',')}.`);
  }
  return record;
}

function str(value: unknown, where: string): string {
  if (typeof value !== 'string') throw new SchemaError(`${where}: esperado texto.`);
  return value;
}

function bool(value: unknown, where: string): boolean {
  if (typeof value !== 'boolean') throw new SchemaError(`${where}: esperado booleano.`);
  return value;
}

function strList(value: unknown, where: string): string[] {
  if (!Array.isArray(value)) throw new SchemaError(`${where}: esperado lista.`);
  return value.map((v, i) => str(v, `${where}[${i}]`));
}

function list(value: unknown, where: string): unknown[] {
  if (!Array.isArray(value)) throw new SchemaError(`${where}: esperado lista.`);
  return value;
}

function parseMatch(value: unknown, i: number): SkuMatch {
  const where = `matches[${i}]`;
  const o = exactObject(value, ['sku_id', 'status', 'evidence_frame_ids', 'reason'], where);
  const status = str(o.status, `${where}.status`);
  if (status !== 'present' && status !== 'absent' && status !== 'uncertain') {
    throw new SchemaError(`${where}.status inválido.`);
  }
  const match: SkuMatch = {
    sku_id: str(o.sku_id, `${where}.sku_id`),
    status,
    evidence_frame_ids: strList(o.evidence_frame_ids, `${where}.evidence_frame_ids`),
    reason: str(o.reason, `${where}.reason`),
  };
  if (!match.reason.trim()) throw new SchemaError('A identificação precisa de um motivo.');
  if (match.status === 'present' && match.evidence_frame_ids.length === 0) {
    throw new SchemaError('Um SKU identificado exige evidência.');
  }
  return match;
}

function nullableStr(value: unknown, where: string): string | null {
  return value === null ? null : str(value, where);
}

/** Inteiro positivo ou null; 0 é tratado como "não informado". */
function positiveIntOrNull(value: unknown, where: string): number | null {
  if (value === null) return null;
  if (!(typeof value === 'number' && Number.isInteger(value) && value >= 0)) {
    throw new SchemaError(`${where} deve ser inteiro não negativo ou null.`);
  }
  return value === 0 ? null : value;
}

export const MAX_BOXES_PER_SKU = 300;
const MAX_LAYOUT_QUANTITY = 1000;

/**
 * Ordem das coordenadas que o modelo escreve. Gemini é treinado com
 * [y_min, x_min, y_max, x_max] e mantém essa ordem mesmo quando o prompt pede
 * outra; Qwen-VL, GPT e a maioria usam [x_min, y_min, x_max, y_max]. Por isso o
 * prompt pede o formato nativo do modelo e o servidor converte para xyxy.
 */
export type BoxFormat = 'xyxy' | 'yxyx';

export const BOX_FORMAT_LABEL: Record<BoxFormat, string> = {
  xyxy: '[x_min, y_min, x_max, y_max]',
  yxyx: '[y_min, x_min, y_max, x_max]',
};

/** Formato nativo pelo nome do modelo; VISION_BOX_FORMAT sobrepõe. */
export function boxFormatFor(model: string, override?: string): BoxFormat {
  const forced = override?.trim().toLowerCase();
  if (forced === 'xyxy' || forced === 'yxyx') return forced;
  return /gemini/i.test(model) ? 'yxyx' : 'xyxy';
}

/**
 * Caixa no formato do modelo, em 0–1000, convertida para [x_min, y_min, x_max, y_max].
 * Números fora da faixa são limitados e cantos invertidos são trocados: só a
 * quantidade de caixas importa para a contagem, e o desenho continua coerente.
 */
function parseBox(value: unknown, where: string, format: BoxFormat): Box {
  if (!Array.isArray(value) || value.length !== 4) throw new SchemaError(`${where}: esperado ${BOX_FORMAT_LABEL[format]}.`);
  const n = value.map((v, k) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new SchemaError(`${where}[${k}]: esperado número.`);
    return Math.round(Math.max(0, Math.min(1000, v)));
  });
  const [x0, y0, x1, y1] = format === 'yxyx' ? [n[1], n[0], n[3], n[2]] : n;
  return [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)];
}

function parseRawCount(value: unknown, i: number, format: BoxFormat): RawSkuCount {
  const where = `counts[${i}]`;
  const o = exactObject(
    value,
    ['sku_id', 'count_frame_id', 'boxes', 'facings', 'depth', 'depth_frame_id', 'incomplete', 'needs_review', 'reason'],
    where,
  );
  const boxes = list(o.boxes, `${where}.boxes`);
  if (boxes.length > MAX_BOXES_PER_SKU) throw new SchemaError(`${where}.boxes: marcações demais.`);
  const row: RawSkuCount = {
    sku_id: str(o.sku_id, `${where}.sku_id`),
    count_frame_id: nullableStr(o.count_frame_id, `${where}.count_frame_id`),
    boxes: boxes.map((b, k) => parseBox(b, `${where}.boxes[${k}]`, format)),
    facings: positiveIntOrNull(o.facings, `${where}.facings`),
    depth: positiveIntOrNull(o.depth, `${where}.depth`),
    depth_frame_id: nullableStr(o.depth_frame_id, `${where}.depth_frame_id`),
    incomplete: bool(o.incomplete, `${where}.incomplete`),
    needs_review: bool(o.needs_review, `${where}.needs_review`),
    reason: str(o.reason, `${where}.reason`),
  };
  if (row.count_frame_id === null && row.boxes.length > 0) {
    throw new SchemaError('Unidades marcadas exigem o frame de contagem (count_frame_id).');
  }
  return row;
}

function area(b: Box): number {
  return (b[2] - b[0]) * (b[3] - b[1]);
}

/** Interseção sobre união de duas caixas (caixas degeneradas idênticas contam como 1). */
export function iou(a: Box, b: Box): number {
  if (a.every((v, k) => v === b[k])) return 1;
  const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  if (w <= 0 || h <= 0) return 0;
  const inter = w * h;
  const union = area(a) + area(b) - inter;
  return union > 0 ? inter / union : 0;
}

/** Remove marcações repetidas da mesma unidade (IoU acima do limite), mantendo a primeira. */
export function dedupeBoxes(boxes: Box[], threshold = 0.5): Box[] {
  const kept: Box[] = [];
  for (const box of boxes) {
    if (!kept.some((other) => iou(box, other) > threshold)) kept.push(box);
  }
  return kept;
}

const NO_FRAME_REASON = 'Nenhum frame permite distinguir as unidades deste produto.';
const REVIEW_REASON = 'Confira a quantidade na prateleira.';

/**
 * Converte as marcações do modelo numa quantidade. O servidor conta as caixas
 * (sem duplicadas) do único frame de contagem; quando o modelo informa o
 * arranjo (frentes × profundidade vista de lado ou de cima) e ele indica mais
 * unidades que as marcadas, usa essa estimativa e sempre pede conferência.
 * Nunca soma frames diferentes.
 */
export function consolidateCount(raw: RawSkuCount, coverageComplete: boolean, overlapResolved: boolean): SkuCount {
  const partial = !coverageComplete || !overlapResolved;
  let quantity: number | null = null;
  let marks: CountMarks | null = null;

  if (raw.count_frame_id !== null) {
    const boxes = dedupeBoxes(raw.boxes);
    const hasLayout = raw.facings !== null && raw.depth !== null && raw.depth >= 2 && raw.depth_frame_id !== null;
    const layout = hasLayout ? Math.min(MAX_LAYOUT_QUANTITY, raw.facings! * raw.depth!) : null;
    const method = layout !== null && layout > boxes.length ? 'layout' : 'marked';
    quantity = method === 'layout' ? layout : boxes.length;
    marks = {
      frame_id: raw.count_frame_id,
      boxes,
      marked: boxes.length,
      duplicates_removed: raw.boxes.length - boxes.length,
      facings: hasLayout ? raw.facings : null,
      depth: hasLayout ? raw.depth : null,
      depth_frame_id: hasLayout ? raw.depth_frame_id : null,
      method,
    };
    // Sem visão da área inteira, nenhuma caixa marcada não comprova estoque zero.
    if (quantity === 0 && (partial || raw.incomplete)) {
      quantity = null;
      marks = null;
    }
  }

  const incomplete = raw.incomplete || partial || quantity === null;
  const needsReview = raw.needs_review || incomplete || marks?.method === 'layout';
  const reason = raw.reason.trim() || (quantity === null ? NO_FRAME_REASON : needsReview ? REVIEW_REASON : '');
  const evidence = marks === null
    ? []
    : [...new Set([marks.frame_id, ...(marks.method === 'layout' && marks.depth_frame_id ? [marks.depth_frame_id] : [])])];
  return {
    sku_id: raw.sku_id,
    quantity,
    incomplete,
    needs_review: needsReview,
    reason,
    evidence_frame_ids: evidence,
    marks,
  };
}

function validateMembership(
  videoIdReturned: string,
  rows: { sku_id: string; evidence_frame_ids: string[] }[],
  videoId: string,
  skuIds: string[],
  frameIds: string[],
): void {
  if (videoIdReturned !== videoId) throw new SchemaError('O modelo respondeu para outro vídeo.');
  if (!skuIds.length || new Set(skuIds).size !== skuIds.length) throw new SchemaError('Envie SKUs sem repetições.');
  if (!frameIds.length || new Set(frameIds).size !== frameIds.length) {
    throw new SchemaError('Envie frames sem repetições.');
  }
  const returned = rows.map((r) => r.sku_id);
  if (new Set(returned).size !== returned.length) throw new SchemaError('O modelo repetiu um SKU.');
  const expected = new Set(skuIds);
  if (returned.length !== expected.size || returned.some((id) => !expected.has(id))) {
    throw new SchemaError('A resposta deve incluir exatamente os SKUs enviados.');
  }
  const frames = new Set(frameIds);
  for (const row of rows) {
    if (new Set(row.evidence_frame_ids).size !== row.evidence_frame_ids.length) {
      throw new SchemaError('Frames de evidência repetidos.');
    }
    if (row.evidence_frame_ids.some((id) => !frames.has(id))) {
      throw new SchemaError('A resposta usa um frame que não foi enviado.');
    }
  }
}

export function parseIdentification(
  payload: unknown,
  videoId: string,
  skuIds: string[],
  frameIds: string[],
): Identification {
  const o = exactObject(payload, ['video_id', 'matches', 'unknown_products'], 'Identification');
  const result: Identification = {
    video_id: str(o.video_id, 'video_id'),
    matches: list(o.matches, 'matches').map(parseMatch),
    unknown_products: strList(o.unknown_products, 'unknown_products'),
  };
  validateMembership(result.video_id, result.matches, videoId, skuIds, frameIds);
  return result;
}

export function parseRawCountResult(
  payload: unknown,
  videoId: string,
  skuIds: string[],
  frameIds: string[],
  boxFormat: BoxFormat = 'xyxy',
): RawCountResult {
  const o = exactObject(
    payload,
    ['video_id', 'coverage_complete', 'overlap_resolved', 'counts', 'unknown_products'],
    'CountResult',
  );
  const result: RawCountResult = {
    video_id: str(o.video_id, 'video_id'),
    coverage_complete: bool(o.coverage_complete, 'coverage_complete'),
    overlap_resolved: bool(o.overlap_resolved, 'overlap_resolved'),
    counts: list(o.counts, 'counts').map((c, i) => parseRawCount(c, i, boxFormat)),
    unknown_products: strList(o.unknown_products, 'unknown_products'),
  };
  // Produtos fora do catálogo (ex.: outros itens na mesma prateleira) são comuns
  // em loja real e não invalidam a contagem.
  validateMembership(
    result.video_id,
    result.counts.map((c) => ({
      sku_id: c.sku_id,
      evidence_frame_ids: [...new Set([c.count_frame_id, c.depth_frame_id].filter((f): f is string => f !== null))],
    })),
    videoId,
    skuIds,
    frameIds,
  );
  return result;
}

/** Valida as marcações do modelo e consolida a quantidade de cada SKU no servidor. */
export function parseCountResult(
  payload: unknown,
  videoId: string,
  skuIds: string[],
  frameIds: string[],
  boxFormat: BoxFormat = 'xyxy',
): CountResult {
  const raw = parseRawCountResult(payload, videoId, skuIds, frameIds, boxFormat);
  return {
    video_id: raw.video_id,
    coverage_complete: raw.coverage_complete,
    overlap_resolved: raw.overlap_resolved,
    counts: raw.counts.map((c) => consolidateCount(c, raw.coverage_complete, raw.overlap_resolved)),
    unknown_products: raw.unknown_products,
  };
}

/** Início da resposta para o log; nunca lança (undefined, BigInt, objetos sem protótipo...). */
function preview(payload: unknown): string {
  try {
    return String(JSON.stringify(payload) ?? typeof payload).slice(0, 2000);
  } catch {
    return `[${typeof payload} não serializável]`;
  }
}

/** Valida e converte qualquer violação em ProviderError com mensagem acionável. */
export function validateStage(
  stage: Stage,
  payload: unknown,
  videoId: string,
  skuIds: string[],
  frameIds: string[],
  opts: { usage?: Record<string, unknown>; requestId?: string | null; boxFormat?: BoxFormat } = {},
): Identification | CountResult {
  const { boxFormat = 'xyxy', ...errorOpts } = opts;
  try {
    return stage === 'identify'
      ? parseIdentification(payload, videoId, skuIds, frameIds)
      : parseCountResult(payload, videoId, skuIds, frameIds, boxFormat);
  } catch (error) {
    if (error instanceof SchemaError) {
      // Só no log do servidor: qual regra falhou e o início da resposta, para
      // ajustar prompt ou modelo sem expor detalhes ao app.
      console.error(`[${stage}] resposta rejeitada: ${error.message}`, preview(payload));
      throw new ProviderError(
        'A resposta do modelo viola o esquema ou as regras de contagem. Tente outra captura.',
        { ...errorOpts, cause: error },
      );
    }
    throw error;
  }
}
