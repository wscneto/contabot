/**
 * Contrato das duas etapas de visão (identificar → contar): esquemas JSON e
 * validação estrita das respostas, portados do antigo backend Python (domain.py).
 */

export type Stage = 'identify' | 'count';

export class ProviderError extends Error {
  usage: Record<string, unknown>;
  requestId: string | null;
  constructor(message: string, opts: { usage?: Record<string, unknown>; requestId?: string | null } = {}) {
    super(message);
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

export interface SkuCount {
  sku_id: string;
  quantity: number | null;
  incomplete: boolean;
  needs_review: boolean;
  reason: string;
  evidence_frame_ids: string[];
}

export interface CountResult {
  video_id: string;
  coverage_complete: boolean;
  overlap_resolved: boolean;
  counts: SkuCount[];
  unknown_products: string[];
}

const stringArray = { type: 'array', items: { type: 'string' } };

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
            quantity: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
            incomplete: { type: 'boolean' },
            needs_review: { type: 'boolean' },
            reason: { type: 'string' },
            evidence_frame_ids: stringArray,
          },
          required: ['sku_id', 'quantity', 'incomplete', 'needs_review', 'reason', 'evidence_frame_ids'],
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

function parseCount(value: unknown, i: number): SkuCount {
  const where = `counts[${i}]`;
  const o = exactObject(
    value,
    ['sku_id', 'quantity', 'incomplete', 'needs_review', 'reason', 'evidence_frame_ids'],
    where,
  );
  const quantity = o.quantity;
  if (quantity !== null && !(typeof quantity === 'number' && Number.isInteger(quantity) && quantity >= 0)) {
    throw new SchemaError(`${where}.quantity deve ser inteiro não negativo ou null.`);
  }
  const count: SkuCount = {
    sku_id: str(o.sku_id, `${where}.sku_id`),
    quantity: quantity as number | null,
    incomplete: bool(o.incomplete, `${where}.incomplete`),
    needs_review: bool(o.needs_review, `${where}.needs_review`),
    reason: str(o.reason, `${where}.reason`),
    evidence_frame_ids: strList(o.evidence_frame_ids, `${where}.evidence_frame_ids`),
  };
  if (count.quantity === null && !count.incomplete) {
    throw new SchemaError('Quantidade desconhecida exige contagem incompleta.');
  }
  if (count.incomplete && !count.needs_review) throw new SchemaError('Contagem incompleta exige revisão.');
  if (count.needs_review && !count.reason.trim()) throw new SchemaError('A revisão precisa de um motivo.');
  if (count.quantity !== null && count.evidence_frame_ids.length === 0) {
    throw new SchemaError('Uma quantidade observada, inclusive zero, exige evidência.');
  }
  return count;
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

export function parseCountResult(
  payload: unknown,
  videoId: string,
  skuIds: string[],
  frameIds: string[],
): CountResult {
  const o = exactObject(
    payload,
    ['video_id', 'coverage_complete', 'overlap_resolved', 'counts', 'unknown_products'],
    'CountResult',
  );
  const result: CountResult = {
    video_id: str(o.video_id, 'video_id'),
    coverage_complete: bool(o.coverage_complete, 'coverage_complete'),
    overlap_resolved: bool(o.overlap_resolved, 'overlap_resolved'),
    counts: list(o.counts, 'counts').map(parseCount),
    unknown_products: strList(o.unknown_products, 'unknown_products'),
  };
  if (!result.coverage_complete || !result.overlap_resolved) {
    if (result.counts.some((c) => !c.incomplete)) {
      throw new SchemaError('Cobertura ou sobreposição pendente impede contagens completas.');
    }
    if (result.counts.some((c) => c.quantity === 0)) {
      throw new SchemaError('Sem visibilidade completa, ausência é desconhecida; use null, não zero.');
    }
  }
  if (!result.overlap_resolved) {
    // Uma única imagem não duplica unidades entre quadros: a contagem positiva é
    // uma observação parcial, nunca o total do vídeo.
    if (result.counts.some((c) => c.quantity !== null && c.evidence_frame_ids.length !== 1)) {
      throw new SchemaError('Sobreposição não resolvida permite quantidade apenas em um único frame.');
    }
  }
  if (result.unknown_products.length && result.counts.length && !result.counts.some((c) => c.needs_review)) {
    throw new SchemaError('Produtos desconhecidos exigem revisão da identificação.');
  }
  validateMembership(result.video_id, result.counts, videoId, skuIds, frameIds);
  return result;
}

/** Valida e converte qualquer violação em ProviderError com mensagem acionável. */
export function validateStage(
  stage: Stage,
  payload: unknown,
  videoId: string,
  skuIds: string[],
  frameIds: string[],
  opts: { usage?: Record<string, unknown>; requestId?: string | null } = {},
): Identification | CountResult {
  try {
    return stage === 'identify'
      ? parseIdentification(payload, videoId, skuIds, frameIds)
      : parseCountResult(payload, videoId, skuIds, frameIds);
  } catch (error) {
    if (error instanceof SchemaError) {
      throw new ProviderError(
        'A resposta do modelo viola o esquema ou as regras de contagem. Tente outra captura.',
        opts,
      );
    }
    throw error;
  }
}
