/**
 * Regras do pipeline identificar → contar, portadas do antigo backend Python (pipeline.py).
 * Sem I/O: a Edge Function analyze-capture carrega dados/imagens e grava o resultado.
 */

import { type FrameCandidate, selectCountingFrames } from './frame-selection.ts';
import type { Box, CountResult, Identification, SkuMatch } from './vision.ts';
import { ProviderError } from './vision.ts';

/** Quadro enviado pelo celular (captures.frames). */
export interface StoredFrame extends FrameCandidate {
  path: string;
  width?: number;
  height?: number;
}

export interface CatalogEntry {
  id: string;
  name: string;
  variant: string;
  /** Caminhos no bucket "media". */
  photos: string[];
}

/** Marcações gravadas em task_items.ai_marks para a conferência desenhar as caixas. */
export interface ItemMarks {
  /** Caminho do quadro de contagem no bucket "media" (o mesmo de evidence_frame). */
  frame: string;
  width: number | null;
  height: number | null;
  /** Ordem das coordenadas gravadas (sempre x primeiro, já convertidas do formato do modelo). */
  coords: 'xyxy';
  /** [x_min, y_min, x_max, y_max] em 0–1000. */
  boxes: Box[];
  marked: number;
  duplicates_removed: number;
  method: 'marked' | 'layout';
  facings: number | null;
  depth: number | null;
  depth_frame: string | null;
}

export interface ItemUpdate {
  product_id: string;
  ai_quantity: number | null;
  ai_status: 'ok' | 'check' | 'missing' | 'manual';
  ai_note: string;
  evidence_frame: string | null;
  ai_marks: ItemMarks | null;
  counted: number | null;
}

export interface ResultFrame {
  id: string;
  path: string;
  timestamp_seconds: number;
}

const byTime = (a: StoredFrame, b: StoredFrame) => a.timestamp_seconds - b.timestamp_seconds;

/** Quadros de visão geral escolhidos no celular (um por faixa de tempo do vídeo). */
export function overviewFrames(pool: StoredFrame[], selectedIds: string[]): StoredFrame[] {
  const selected = new Set(selectedIds);
  return pool.filter((f) => selected.has(f.id)).sort(byTime);
}

/**
 * Quadros da etapa de identificação. Usa todos os quadros enviados pelo celular
 * quando cabem numa única chamada junto com as fotos do catálogo; senão, completa
 * os de visão geral com os mais distantes no tempo dos já escolhidos. Com um
 * catálogo grande demais, volta aos de visão geral e o catálogo vai em lotes.
 */
export function identificationFrames(
  pool: StoredFrame[],
  selectedIds: string[],
  catalog: CatalogEntry[],
  maxImages: number,
  maxIdentifyFrames: number,
): StoredFrame[] {
  const ordered = [...pool].sort(byTime);
  const chosen = overviewFrames(ordered, selectedIds);
  const photos = catalog.reduce((n, sku) => n + sku.photos.length, 0);
  const budget = Math.max(chosen.length, Math.min(maxIdentifyFrames, ordered.length, maxImages - photos));
  if (budget >= ordered.length) return ordered;

  const rest = ordered.filter((f) => !chosen.includes(f));
  while (chosen.length < budget && rest.length) {
    let best = 0;
    let bestKey = -Infinity;
    rest.forEach((frame, index) => {
      const gap = chosen.length
        ? Math.min(...chosen.map((c) => Math.abs(c.timestamp_seconds - frame.timestamp_seconds)))
        : 0;
      const key = gap + 0.3 * Math.max(0, Math.min(1, frame.metrics?.quality ?? 0));
      if (key > bestKey) {
        bestKey = key;
        best = index;
      }
    });
    chosen.push(...rest.splice(best, 1));
  }
  return chosen.sort(byTime);
}

/** Lotes de SKUs cujas fotos cabem, junto com os quadros, no limite de imagens. */
export function identificationBatches(
  catalog: CatalogEntry[],
  frameCount: number,
  maxImages: number,
): CatalogEntry[][] {
  const capacity = maxImages - frameCount;
  if (catalog.some((sku) => sku.photos.length > capacity)) {
    throw new ProviderError('Há fotos de referência demais para o limite de imagens.');
  }
  const batches: CatalogEntry[][] = [];
  let batch: CatalogEntry[] = [];
  let used = 0;
  for (const sku of catalog) {
    if (used + sku.photos.length > capacity) {
      batches.push(batch);
      batch = [];
      used = 0;
    }
    batch.push(sku);
    used += sku.photos.length;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

export function mergeIdentifications(videoId: string, parts: Identification[]): Identification {
  return {
    video_id: videoId,
    matches: parts.flatMap((p) => p.matches),
    unknown_products: [...new Set(parts.flatMap((p) => p.unknown_products))],
  };
}

export function possibleSkus(catalog: CatalogEntry[], identification: Identification): CatalogEntry[] {
  const ids = new Set(identification.matches.filter((m) => m.status !== 'absent').map((m) => m.sku_id));
  return catalog.filter((sku) => ids.has(sku.id));
}

export function toResultFrames(frames: StoredFrame[]): ResultFrame[] {
  return frames.map(({ id, path, timestamp_seconds }) => ({ id, path, timestamp_seconds }));
}

function normalizeNote(reason: string | undefined, fallback: string): string {
  const trimmed = reason?.trim();
  return trimmed ? trimmed : fallback;
}

/** Nenhum SKU provável: todos os itens ficam "missing" com o motivo do modelo. */
export function noMatchItems(catalog: CatalogEntry[], matches: SkuMatch[]): ItemUpdate[] {
  return catalog.map((sku) => {
    const match = matches.find((m) => m.sku_id === sku.id);
    return {
      product_id: sku.id,
      ai_quantity: null,
      ai_status: 'missing',
      ai_note: normalizeNote(match?.reason, 'Não identificado na captura.'),
      evidence_frame: null,
      ai_marks: null,
      counted: null,
    };
  });
}

/** Quadros da etapa de contagem: identificação + vizinhos das evidências. */
export function countingFrames(
  pool: StoredFrame[],
  identificationFrames: StoredFrame[],
  possible: CatalogEntry[],
  identification: Identification,
  maxImages: number,
  maxCountFrames: number,
): StoredFrame[] {
  const possibleIds = new Set(possible.map((s) => s.id));
  const evidence = new Set(
    identification.matches.filter((m) => possibleIds.has(m.sku_id)).flatMap((m) => m.evidence_frame_ids),
  );
  const imageBudget = maxImages - possible.reduce((n, s) => n + s.photos.length, 0);
  if (imageBudget < identificationFrames.length) {
    throw new ProviderError('Produtos demais para distinguir nesta captura. Filme uma área menor.');
  }
  const countBudget = Math.min(maxCountFrames, imageBudget);
  const context = identificationFrames.filter((f) => !evidence.has(f.id));
  const neighbors = evidence.size
    ? selectCountingFrames(pool, [...evidence].sort(), Math.max(1, countBudget - context.length))
    : [];
  const byId = new Map<string, StoredFrame>();
  for (const frame of [...identificationFrames, ...neighbors]) byId.set(frame.id, frame);
  return [...byId.values()].sort(byTime);
}

function plural(n: number, singular: string, pluralForm: string): string {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

/** Resumo de como a quantidade foi obtida, antes do motivo do modelo. */
export function marksSummary(marks: ItemMarks, quantity: number): string {
  const marked = plural(marks.marked, 'unidade marcada', 'unidades marcadas');
  const repeated = marks.duplicates_removed
    ? ` (${plural(marks.duplicates_removed, 'marcação repetida descartada', 'marcações repetidas descartadas')})`
    : '';
  if (marks.method === 'layout') {
    return `Estimativa pelo arranjo: ${plural(marks.facings!, 'frente', 'frentes')} × ${marks.depth} de profundidade = ` +
      `${quantity}; ${marked} na imagem${repeated}. Confira as unidades do fundo.`;
  }
  return `${marked} na imagem${repeated}.`;
}

/** Converte a contagem do modelo nos campos de task_items (pipeline._execute_pipeline). */
export function countItems(
  catalog: CatalogEntry[],
  identification: Identification,
  result: CountResult,
  frames: StoredFrame[],
): ItemUpdate[] {
  const frameById = new Map(frames.map((f) => [f.id, f]));
  const counts = new Map(result.counts.map((c) => [c.sku_id, c]));
  return catalog.map((sku) => {
    const count = counts.get(sku.id);
    if (!count) {
      const match = identification.matches.find((m) => m.sku_id === sku.id);
      return {
        product_id: sku.id,
        ai_quantity: null,
        ai_status: 'missing',
        ai_note: normalizeNote(match?.reason, 'Não observado nos frames.'),
        evidence_frame: null,
        ai_marks: null,
        counted: null,
      };
    }
    const status = count.quantity === null
      ? 'missing'
      : count.incomplete || count.needs_review
      ? 'check'
      : 'ok';
    const firstEvidence = count.evidence_frame_ids[0];
    const marks = count.marks;
    const frame = marks ? frameById.get(marks.frame_id) : undefined;
    const aiMarks: ItemMarks | null = marks && frame
      ? {
        frame: frame.path,
        width: frame.width ?? null,
        height: frame.height ?? null,
        coords: 'xyxy',
        boxes: marks.boxes,
        marked: marks.marked,
        duplicates_removed: marks.duplicates_removed,
        method: marks.method,
        facings: marks.facings,
        depth: marks.depth,
        depth_frame: marks.depth_frame_id ? frameById.get(marks.depth_frame_id)?.path ?? null : null,
      }
      : null;
    const summary = aiMarks && count.quantity !== null ? marksSummary(aiMarks, count.quantity) : '';
    return {
      product_id: sku.id,
      ai_quantity: count.quantity,
      ai_status: status,
      ai_note: [summary, normalizeNote(count.reason, '')].filter(Boolean).join(' '),
      evidence_frame: firstEvidence ? frameById.get(firstEvidence)?.path ?? null : null,
      ai_marks: aiMarks,
      // Qualquer item com quantidade sugerida pela IA (ok ou check) já chega preenchido para conferência.
      counted: count.quantity,
    };
  });
}
