/**
 * Testes baseados em propriedades (fuzzing) com fast-check.
 *
 * Em vez de exemplos fixos, cada propriedade é verificada contra centenas de
 * entradas geradas aleatoriamente (e reduzidas ao menor contraexemplo quando
 * falham). Foco: tudo que recebe dado externo — a resposta do modelo de visão,
 * o texto bruto da API e os quadros vindos do celular.
 *
 *   cd supabase/functions && deno test tests/
 */
import { assert, assertEquals, assertThrows } from 'jsr:@std/assert@1';
import fc from 'npm:fast-check@3.23.2';
import { hashAccessCode, normalizeAccessCode, generateAccessCode } from '../_shared/access-code.ts';
import { type CatalogEntry, countItems, type StoredFrame } from '../_shared/analysis.ts';
import {
  candidateTimes,
  computeFingerprint,
  type FrameCandidate,
  frameId,
  selectIdentificationFrames,
  selectUploadPool,
} from '../_shared/frame-selection.ts';
import { parseModelJson } from '../_shared/providers.ts';
import { type CountResult, type Identification, ProviderError, validateStage } from '../_shared/vision.ts';

const RUNS = { numRuns: 300 };

// O validador registra cada rejeição no console; silencia durante o fuzzing.
function quietly<T>(fn: () => T): T {
  const original = console.error;
  console.error = () => {};
  try {
    return fn();
  } finally {
    console.error = original;
  }
}

// ---------------------------------------------------------------------------
// Geradores
// ---------------------------------------------------------------------------

const id = fc.stringMatching(/^[a-z0-9-]{1,12}$/);
const nonBlank = fc.string({ minLength: 1, maxLength: 40 }).filter((s) => s.trim().length > 0);

interface Scenario {
  videoId: string;
  skuIds: string[];
  frameIds: string[];
}

const scenario: fc.Arbitrary<Scenario> = fc.record({
  videoId: id,
  skuIds: fc.uniqueArray(id, { minLength: 1, maxLength: 6 }),
  frameIds: fc.uniqueArray(id.map((x) => `f-${x}`), { minLength: 1, maxLength: 8 }),
});

const evidenceFrom = (frameIds: string[]) => fc.shuffledSubarray(frameIds);

/** Identificação que respeita todas as regras do contrato. */
const validIdentification = scenario.chain((s) =>
  fc.tuple(
    fc.constant(s),
    fc.tuple(
      ...s.skuIds.map((sku) =>
        fc.record({
          status: fc.constantFrom('present', 'absent', 'uncertain'),
          evidence: evidenceFrom(s.frameIds),
          reason: nonBlank,
        }).map(({ status, evidence, reason }) => ({
          sku_id: sku,
          status,
          evidence_frame_ids: status === 'present' && evidence.length === 0 ? [s.frameIds[0]] : evidence,
          reason,
        }))
      ),
    ),
    fc.array(fc.string({ maxLength: 30 }), { maxLength: 3 }),
  ).map(([sc, matches, unknown]) => ({
    sc,
    payload: { video_id: sc.videoId, matches, unknown_products: unknown } as Identification,
  }))
);

/** Contagem que respeita todas as regras do contrato. */
const validCount = scenario.chain((s) =>
  fc.tuple(
    fc.constant(s),
    fc.boolean(),
    fc.boolean(),
    fc.tuple(
      ...s.skuIds.map((sku) =>
        fc.record({
          quantity: fc.option(fc.nat({ max: 500 }), { nil: null }),
          incomplete: fc.boolean(),
          needsReview: fc.boolean(),
          reason: nonBlank,
          evidence: evidenceFrom(s.frameIds),
        }).map((r) => ({ sku, ...r }))
      ),
    ),
    fc.array(fc.string({ maxLength: 30 }), { maxLength: 3 }),
  ).map(([sc, coverage, overlap, rows, unknown]) => {
    const partial = !coverage || !overlap;
    const counts = rows.map((r) => {
      let quantity = r.quantity;
      if (partial && quantity === 0) quantity = null; // sem visibilidade completa, zero é desconhecido
      const incomplete = partial || quantity === null || r.incomplete;
      let evidence = r.evidence;
      if (quantity !== null && evidence.length === 0) evidence = [sc.frameIds[0]];
      if (!overlap && quantity !== null) evidence = evidence.slice(0, 1);
      return {
        sku_id: r.sku,
        quantity,
        incomplete,
        needs_review: incomplete || r.needsReview,
        reason: r.reason,
        evidence_frame_ids: evidence,
      };
    });
    return {
      sc,
      payload: {
        video_id: sc.videoId,
        coverage_complete: coverage,
        overlap_resolved: overlap,
        counts,
        unknown_products: unknown,
      } as CountResult,
    };
  })
);

/** Mutações que sempre tornam a resposta inválida. */
type Mutation = (p: Record<string, unknown>, rowsKey: string, sc: Scenario) => Record<string, unknown>;
const MUTATIONS: Record<string, Mutation> = {
  'remove campo obrigatório': (p) => {
    const { video_id: _, ...rest } = p;
    return rest;
  },
  'adiciona campo extra': (p) => ({ ...p, confidence: 0.99 }),
  'troca o vídeo': (p) => ({ ...p, video_id: `${p.video_id}-outro` }),
  'repete um SKU': (p, k) => ({ ...p, [k]: [...(p[k] as unknown[]), (p[k] as unknown[])[0]] }),
  'omite um SKU': (p, k) => ({ ...p, [k]: (p[k] as unknown[]).slice(1) }),
  'SKU desconhecido': (p, k) => ({
    ...p,
    [k]: (p[k] as Record<string, unknown>[]).map((r, i) => (i === 0 ? { ...r, sku_id: 'sku-inventado-xyz' } : r)),
  }),
  'frame não enviado como evidência': (p, k) => ({
    ...p,
    [k]: (p[k] as Record<string, unknown>[]).map((r, i) =>
      i === 0 ? { ...r, evidence_frame_ids: [...(r.evidence_frame_ids as string[]), 'frame-fantasma'] } : r
    ),
  }),
  'linhas viram texto': (p, k) => ({ ...p, [k]: 'nenhum' }),
  'lista de desconhecidos com número': (p) => ({ ...p, unknown_products: [42] }),
};

// ---------------------------------------------------------------------------
// Validação da resposta do modelo de visão
// ---------------------------------------------------------------------------

Deno.test('fuzz: qualquer resposta do modelo vira resultado válido ou ProviderError (nunca outro erro)', () => {
  quietly(() =>
    fc.assert(
      fc.property(
        fc.constantFrom('identify' as const, 'count' as const),
        fc.oneof(fc.anything(), fc.jsonValue()),
        scenario,
        (stage, payload, sc) => {
          try {
            validateStage(stage, payload, sc.videoId, sc.skuIds, sc.frameIds);
          } catch (error) {
            assert(error instanceof ProviderError, `erro inesperado: ${error}`);
          }
        },
      ),
      { numRuns: 1000 },
    )
  );
});

Deno.test('propriedade: identificação que respeita o contrato é aceita sem alterações', () => {
  fc.assert(
    fc.property(validIdentification, ({ sc, payload }) => {
      const out = validateStage('identify', payload, sc.videoId, sc.skuIds, sc.frameIds);
      assertEquals(out, payload);
    }),
    RUNS,
  );
});

Deno.test('propriedade: contagem que respeita o contrato é aceita sem alterações', () => {
  fc.assert(
    fc.property(validCount, ({ sc, payload }) => {
      const out = validateStage('count', payload, sc.videoId, sc.skuIds, sc.frameIds);
      assertEquals(out, payload);
    }),
    RUNS,
  );
});

Deno.test('propriedade: qualquer mutação que quebra o contrato é rejeitada', () => {
  const names = Object.keys(MUTATIONS);
  quietly(() =>
    fc.assert(
      fc.property(
        fc.oneof(
          validIdentification.map((v) => ({ ...v, stage: 'identify' as const, rows: 'matches' })),
          validCount.map((v) => ({ ...v, stage: 'count' as const, rows: 'counts' })),
        ),
        fc.constantFrom(...names),
        ({ sc, payload, stage, rows }, mutation) => {
          const mutated = MUTATIONS[mutation](payload as unknown as Record<string, unknown>, rows, sc);
          assertThrows(
            () => validateStage(stage, mutated, sc.videoId, sc.skuIds, sc.frameIds),
            ProviderError,
            undefined,
            `mutação "${mutation}" deveria ser rejeitada`,
          );
        },
      ),
      RUNS,
    )
  );
});

Deno.test('propriedade: countItems cobre o catálogo inteiro e o status reflete a sugestão', () => {
  fc.assert(
    fc.property(validCount, ({ sc, payload }) => {
      const catalog: CatalogEntry[] = sc.skuIds.map((sku) => ({ id: sku, name: sku, variant: '', photos: [] }));
      const frames = sc.frameIds.map((fid, i) => ({ id: fid, path: `x/${fid}.jpg`, timestamp_seconds: i })) as
        unknown as StoredFrame[];
      const identification: Identification = { video_id: sc.videoId, matches: [], unknown_products: [] };
      const items = countItems(catalog, identification, payload, frames);
      assertEquals(items.map((i) => i.product_id), sc.skuIds);
      for (const item of items) {
        const row = payload.counts.find((c) => c.sku_id === item.product_id)!;
        assertEquals(item.ai_quantity, row.quantity);
        assertEquals(item.counted, row.quantity, 'sugestão chega pré-preenchida');
        const expected = row.quantity === null ? 'missing' : row.incomplete || row.needs_review ? 'check' : 'ok';
        assertEquals(item.ai_status, expected);
        if (item.evidence_frame) assert(item.evidence_frame.endsWith(`${row.evidence_frame_ids[0]}.jpg`));
      }
    }),
    RUNS,
  );
});

// ---------------------------------------------------------------------------
// Texto bruto devolvido pela API do modelo
// ---------------------------------------------------------------------------

Deno.test('fuzz: parseModelJson nunca lança, para qualquer texto', () => {
  fc.assert(
    fc.property(fc.oneof(fc.string(), fc.fullUnicodeString(), fc.json()), (text) => {
      parseModelJson(text);
    }),
    { numRuns: 1000 },
  );
});

Deno.test('propriedade: parseModelJson recupera o JSON com <think>, cercas de markdown e espaços', () => {
  fc.assert(
    fc.property(
      fc.jsonValue(),
      fc.constantFrom('', '<think>raciocínio {"falso": 1}</think>\n'),
      fc.constantFrom(['', ''], ['```json\n', '\n```'], ['```\n', '\n```'], ['  \n', '\n  ']),
      (value, think, [open, close]) => {
        const text = `${think}${open}${JSON.stringify(value)}${close}`;
        assertEquals(JSON.stringify(parseModelJson(text)), JSON.stringify(value));
      },
    ),
    RUNS,
  );
});

// ---------------------------------------------------------------------------
// Seleção de quadros (roda no celular, com dados do vídeo)
// ---------------------------------------------------------------------------

const fingerprint = fc.uint8Array({ minLength: 4 * 4 * 4, maxLength: 4 * 4 * 4 }).map((data) =>
  computeFingerprint({ data, width: 4, height: 4 })
);

const candidates = fc.tuple(
  fc.double({ min: 1, max: 60, noNaN: true }),
  fc.array(
    fc.record({
      t: fc.double({ min: 0, max: 1, noNaN: true }),
      quality: fc.double({ min: 0, max: 1, noNaN: true }),
      fingerprint,
    }),
    { minLength: 1, maxLength: 30 },
  ),
).map(([duration, rows]) => ({
  duration,
  list: rows.map((r, i): FrameCandidate => ({
    id: frameId(i),
    timestamp_seconds: r.t * duration,
    metrics: { sharpness: 100, exposure: 0.8, motion: 0, glare: 0, quality: r.quality },
    warnings: [],
    fingerprint: r.fingerprint,
  })),
}));

Deno.test('propriedade: seleção de identificação escolhe 1..N quadros distintos e o principal está entre eles', () => {
  fc.assert(
    fc.property(candidates, fc.integer({ min: 1, max: 10 }), ({ duration, list }, maxFrames) => {
      const { selectedIds, primaryId } = selectIdentificationFrames(list, maxFrames, duration);
      const all = new Set(list.map((c) => c.id));
      assert(selectedIds.length >= 1 && selectedIds.length <= maxFrames);
      assertEquals(new Set(selectedIds).size, selectedIds.length);
      assert(selectedIds.every((x) => all.has(x)));
      assert(selectedIds.includes(primaryId));
    }),
    RUNS,
  );
});

Deno.test('propriedade: pool de envio contém a seleção, respeita o limite e sai em ordem temporal', () => {
  fc.assert(
    fc.property(
      candidates,
      fc.integer({ min: 1, max: 5 }),
      fc.integer({ min: 0, max: 20 }),
      ({ duration, list }, maxIdent, extra) => {
        const { selectedIds } = selectIdentificationFrames(list, maxIdent, duration);
        const maxFrames = selectedIds.length + extra;
        const pool = selectUploadPool(list, selectedIds, maxFrames);
        assert(selectedIds.every((x) => pool.includes(x)), 'quadros escolhidos sempre vão');
        assert(pool.length <= maxFrames);
        assertEquals(new Set(pool).size, pool.length);
        const times = pool.map((pid) => list.find((c) => c.id === pid)!.timestamp_seconds);
        assert(times.every((t, i) => i === 0 || t >= times[i - 1]));
      },
    ),
    RUNS,
  );
});

Deno.test('propriedade: instantes de amostragem ficam dentro do vídeo, crescentes e dentro do limite', () => {
  fc.assert(
    fc.property(
      fc.double({ min: 0.05, max: 600, noNaN: true }),
      fc.double({ min: 0.1, max: 30, noNaN: true }),
      fc.integer({ min: 1, max: 200 }),
      (duration, hz, max) => {
        const times = candidateTimes(duration, hz, max);
        assert(times.length >= 1 && times.length <= max);
        assert(times.every((t) => t >= 0 && t <= duration));
        assert(times.every((t, i) => i === 0 || t > times[i - 1]));
      },
    ),
    RUNS,
  );
  for (const [d, hz, max] of [[0, 1, 10], [-5, 1, 10], [Number.NaN, 1, 10], [10, 0, 10], [10, 1, 0]]) {
    assertEquals(candidateTimes(d, hz, max), []);
  }
});

Deno.test('propriedade: ids de quadro sempre casam com o formato exigido pelo banco (^f[0-9]{4}$)', () => {
  fc.assert(fc.property(fc.integer({ min: 0, max: 9998 }), (i) => /^f[0-9]{4}$/.test(frameId(i))), RUNS);
});

// ---------------------------------------------------------------------------
// Códigos de acesso
// ---------------------------------------------------------------------------

Deno.test('propriedade: normalização do código é idempotente e o hash ignora caixa, hífens e espaços', async () => {
  await fc.assert(
    fc.asyncProperty(fc.stringMatching(/^[A-HJ-NP-Z2-9]{8}$/), fc.boolean(), async (raw, lower) => {
      const decorated = `  ${raw.slice(0, 4)}-${raw.slice(4)} `;
      const variant = lower ? decorated.toLowerCase() : decorated;
      assertEquals(normalizeAccessCode(normalizeAccessCode(variant)), normalizeAccessCode(variant));
      assertEquals(await hashAccessCode(variant), await hashAccessCode(raw));
    }),
    RUNS,
  );
  await fc.assert(
    fc.asyncProperty(fc.string(), async (text) => {
      const h = await hashAccessCode(text);
      assert(/^[0-9a-f]{64}$/.test(h));
    }),
    RUNS,
  );
});

Deno.test('propriedade: códigos gerados usam só o alfabeto sem ambiguidade e não se repetem', () => {
  const seen = new Set<string>();
  const used = new Set<string>();
  for (let i = 0; i < 5000; i++) {
    const { raw, formatted } = generateAccessCode();
    assert(/^[A-HJ-NP-Z2-9]{8}$/.test(raw), raw);
    assertEquals(formatted, `${raw.slice(0, 4)}-${raw.slice(4)}`);
    assertEquals(normalizeAccessCode(formatted), raw);
    seen.add(raw);
    for (const ch of raw) used.add(ch);
  }
  assertEquals(seen.size, 5000, 'colisão em 5000 códigos (espaço de 32^8)');
  assertEquals(used.size, 32, 'todas as 32 letras/dígitos do alfabeto aparecem');
});
