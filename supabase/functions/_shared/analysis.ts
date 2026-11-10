/**
 * Regras do pipeline identificar → contar, portadas do antigo backend Python (pipeline.py).
 * Sem I/O: a Edge Function analyze-capture carrega dados/imagens e grava o resultado.
 */

import { type FrameCandidate, selectCountingFrames } from './frame-selection.ts';
import type { CountResult, Identification, SkuMatch } from './vision.ts';
import { ProviderError } from './vision.ts';

/** Quadro enviado pelo celular (captures.frames). */
export interface StoredFrame extends FrameCandidate {
  path: string;
}

export interface CatalogEntry {
  id: string;
  name: string;
  variant: string;
  /** Caminhos no bucket "media". */
  photos: string[];
}

export interface ItemUpdate {
  product_id: string;
  ai_quantity: number | null;
  ai_status: 'ok' | 'check' | 'missing' | 'manual';
  ai_note: string;
  evidence_frame: string | null;
  counted: number | null;
}

export interface ResultFrame {
  id: string;
  path: string;
  timestamp_seconds: number;
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

/** Nenhum SKU provável: todos os itens ficam "missing" com o motivo do modelo. */
export function noMatchItems(catalog: CatalogEntry[], matches: SkuMatch[]): ItemUpdate[] {
  return catalog.map((sku) => {
    const match = matches.find((m) => m.sku_id === sku.id);
    return {
      product_id: sku.id,
      ai_quantity: null,
      ai_status: 'missing',
      ai_note: (match?.reason ?? 'Não identificado na captura.').slice(0, 300),
      evidence_frame: null,
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
  return [...byId.values()].sort((a, b) => a.timestamp_seconds - b.timestamp_seconds);
}

/** Converte a contagem do modelo nos campos de task_items (pipeline._execute_pipeline). */
export function countItems(
  catalog: CatalogEntry[],
  identification: Identification,
  result: CountResult,
  frames: StoredFrame[],
): ItemUpdate[] {
  const pathById = new Map(frames.map((f) => [f.id, f.path]));
  const counts = new Map(result.counts.map((c) => [c.sku_id, c]));
  return catalog.map((sku) => {
    const count = counts.get(sku.id);
    if (!count) {
      const match = identification.matches.find((m) => m.sku_id === sku.id);
      return {
        product_id: sku.id,
        ai_quantity: null,
        ai_status: 'missing',
        ai_note: (match?.reason ?? 'Não observado nos frames.').slice(0, 300),
        evidence_frame: null,
        counted: null,
      };
    }
    const status = count.quantity === null
      ? 'missing'
      : count.incomplete || count.needs_review
      ? 'check'
      : 'ok';
    const firstEvidence = count.evidence_frame_ids[0];
    return {
      product_id: sku.id,
      ai_quantity: count.quantity,
      ai_status: status,
      ai_note: count.reason.slice(0, 300),
      evidence_frame: firstEvidence ? pathById.get(firstEvidence) ?? null : null,
      // Itens "ok" já chegam preenchidos para a conferência do funcionário.
      counted: status === 'ok' ? count.quantity : null,
    };
  });
}
