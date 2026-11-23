/**
 * Priorização e filtragem de itens na tela de conferência de contagem.
 *
 * Itens marcados pela IA com dúvida ou não encontrados aparecem primeiro para
 * agilizar a conferência em frente à gôndola. A ordenação usa apenas `ai_status`
 * e nome para que os cards não mudem de posição enquanto a pessoa ajusta números.
 */

export type ReviewFilter = 'all' | 'attention';

export interface ReviewItemLike {
  product_id: string;
  name: string;
  ai_status: 'ok' | 'check' | 'missing' | 'manual' | string;
}

const AI_STATUS_PRIORITY: Record<string, number> = {
  missing: 0,
  check: 1,
  manual: 2,
  ok: 3,
};

/** Indica se o item requer atenção na conferência (alerta da IA ou ainda sem quantidade). */
export function itemNeedsAttention(
  item: ReviewItemLike,
  currentCount: number | null | undefined,
): boolean {
  if (currentCount === null || currentCount === undefined) return true;
  return item.ai_status !== 'ok';
}

/** Ordena itens colocando os que exigem atenção no topo, preservando ordem alfabética. */
export function sortReviewItems<T extends ReviewItemLike>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const prioA = AI_STATUS_PRIORITY[a.ai_status] ?? 2;
    const prioB = AI_STATUS_PRIORITY[b.ai_status] ?? 2;
    if (prioA !== prioB) return prioA - prioB;
    return a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' });
  });
}

/** Filtra itens conforme a aba selecionada (`all` ou `attention`). */
export function filterReviewItems<T extends ReviewItemLike>(
  items: T[],
  filter: ReviewFilter,
  counts: Record<string, number | null>,
): T[] {
  if (filter === 'all') return items;
  return items.filter((item) => itemNeedsAttention(item, counts[item.product_id]));
}

/** Conta quantos itens requerem atenção na conferência. */
export function countAttentionItems(
  items: ReviewItemLike[],
  counts: Record<string, number | null>,
): number {
  return items.filter((item) => itemNeedsAttention(item, counts[item.product_id])).length;
}
