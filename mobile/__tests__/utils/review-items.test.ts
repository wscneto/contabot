import {
  countAttentionItems,
  filterReviewItems,
  itemNeedsAttention,
  sortReviewItems,
  type ReviewItemLike,
} from '@/utils/review-items';

const items: ReviewItemLike[] = [
  { product_id: 'p-ok-b', name: 'Biscoito', ai_status: 'ok' },
  { product_id: 'p-check', name: 'Café', ai_status: 'check' },
  { product_id: 'p-ok-a', name: 'Açúcar', ai_status: 'ok' },
  { product_id: 'p-missing', name: 'Leite', ai_status: 'missing' },
  { product_id: 'p-manual', name: 'Arroz', ai_status: 'manual' },
  { product_id: 'p-unknown-b', name: 'Zimbro', ai_status: 'custom-b' },
  { product_id: 'p-unknown-a', name: 'Açafrão', ai_status: 'custom-a' },
];

describe('utils/review-items', () => {
  test('sortReviewItems coloca missing, check, manual e ok nessa ordem com desempate alfabético', () => {
    const sorted = sortReviewItems(items);
    expect(sorted.map((i) => i.product_id)).toEqual([
      'p-missing',
      'p-check',
      'p-unknown-a',
      'p-manual',
      'p-unknown-b',
      'p-ok-a',
      'p-ok-b',
    ]);
    // Não muta o array original
    expect(items[0].product_id).toBe('p-ok-b');
  });

  test('itemNeedsAttention identifica status diferente de ok ou quantidade vazia', () => {
    expect(itemNeedsAttention({ product_id: '1', name: 'A', ai_status: 'ok' }, 5)).toBe(false);
    expect(itemNeedsAttention({ product_id: '1', name: 'A', ai_status: 'ok' }, 0)).toBe(false);
    expect(itemNeedsAttention({ product_id: '1', name: 'A', ai_status: 'ok' }, null)).toBe(true);
    expect(itemNeedsAttention({ product_id: '1', name: 'A', ai_status: 'ok' }, undefined)).toBe(true);
    expect(itemNeedsAttention({ product_id: '1', name: 'A', ai_status: 'check' }, 5)).toBe(true);
    expect(itemNeedsAttention({ product_id: '1', name: 'A', ai_status: 'missing' }, 0)).toBe(true);
    expect(itemNeedsAttention({ product_id: '1', name: 'A', ai_status: 'manual' }, 2)).toBe(true);
  });

  test('filterReviewItems e countAttentionItems filtram e contam itens pendentes corretamente', () => {
    const counts: Record<string, number | null> = {
      'p-ok-a': 3,
      'p-ok-b': null,
      'p-check': 2,
      'p-missing': null,
      'p-manual': 1,
      'p-unknown-b': 4,
      'p-unknown-a': 1,
    };

    expect(filterReviewItems(items, 'all', counts)).toHaveLength(7);
    const attention = filterReviewItems(items, 'attention', counts);
    expect(attention.map((i) => i.product_id)).toEqual([
      'p-ok-b',
      'p-check',
      'p-missing',
      'p-manual',
      'p-unknown-b',
      'p-unknown-a',
    ]);
    expect(countAttentionItems(items, counts)).toBe(6);
  });
});
