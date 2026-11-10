import { assert, assertEquals, assertThrows } from 'jsr:@std/assert@1';
import {
  areSimilar,
  candidateTimes,
  computeFingerprint,
  computeQuality,
  type FrameCandidate,
  type RgbaImage,
  selectCountingFrames,
  selectIdentificationFrames,
  selectUploadPool,
} from '../_shared/frame-selection.ts';

function solid(width: number, height: number, [r, g, b]: number[]): RgbaImage {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  }
  return { data, width, height };
}

function checker(width: number, height: number, cell: number): RgbaImage {
  const image = solid(width, height, [0, 0, 0]);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 ? 230 : 25;
      const p = (y * width + x) * 4;
      image.data[p] = image.data[p + 1] = image.data[p + 2] = v;
    }
  }
  return image;
}

/** Mesmo fixture do antigo teste Python test_video.py::counting_candidates. */
function countingCandidates(timestamps: number[], identical = false): FrameCandidate[] {
  return timestamps.map((t, index) => {
    const color = identical ? [35, 95, 150] : [25 + index * 11, 50 + index * 9, 160 - index * 7];
    return {
      id: `c${index}`,
      timestamp_seconds: t,
      metrics: { sharpness: 0, exposure: 0, motion: 0, glare: 0, quality: index === 0 ? 1 : 0.3 },
      warnings: [],
      fingerprint: computeFingerprint(solid(160, 90, color)),
      selection_reason: 'original',
    };
  });
}

const times = (frames: FrameCandidate[]) => frames.map((f) => f.timestamp_seconds);

Deno.test('contagem mantém vistas posteriores menos nítidas em vez de só a frontal', () => {
  const candidates = countingCandidates([0, 1, 2, 3, 4, 5, 6, 12]);
  const selected = selectCountingFrames(candidates, ['c0'], 3);
  assertEquals(times(selected), [0, 2, 4]);
  assert(candidates.every((c) => c.selection_reason === 'original'), 'não altera os candidatos originais');
  assert(selected[1].selection_reason!.includes('topo/laterais'));
});

Deno.test('vizinhos cobrem antes e depois do reconhecimento', () => {
  const candidates = countingCandidates([...Array(13).keys()]);
  assertEquals(times(selectCountingFrames(candidates, ['c6'], 5)), [2, 4, 6, 8, 10]);
});

Deno.test('perto do fim inclui vista lateral e o último quadro', () => {
  const candidates = countingCandidates([57, 59, 61, 63, 65, 67, 68, 68.9]);
  assertEquals(times(selectCountingFrames(candidates, ['c3'], 6)), [59, 61, 63, 65, 67, 68.9]);
});

Deno.test('complementos idênticos são descartados, evidências preservadas', () => {
  const candidates = countingCandidates([0, 1, 2, 3, 4], true);
  assertEquals(selectCountingFrames(candidates, ['c0', 'c2'], 5).map((f) => f.id), ['c0', 'c2']);
});

Deno.test('orçamento e janela local são limites rígidos', () => {
  const candidates = countingCandidates([0, 2, 4, 6, 12]);
  assertEquals(times(selectCountingFrames(candidates, ['c0'], 10)), [0, 2, 4, 6]);
  assertEquals(selectCountingFrames(candidates, ['c0', 'c2', 'c4'], 2).map((f) => f.id), ['c0', 'c4']);
});

Deno.test('sem evidência mantém cobertura temporal', () => {
  const candidates = countingCandidates([...Array(11).keys()]);
  assertEquals(times(selectCountingFrames(candidates, [], 3)), [0, 5, 10]);
  assertEquals(selectCountingFrames([], [], 3), []);
});

Deno.test('rejeita evidência desconhecida e limites inválidos', () => {
  const candidates = countingCandidates([0, 2]);
  assertThrows(() => selectCountingFrames(candidates, ['x'], 3), Error, 'desconhecido');
  assertThrows(() => selectCountingFrames([], ['x'], 3), Error, 'não encontrado');
  for (const max of [0, 501, 1.5]) assertThrows(() => selectCountingFrames(candidates, [], max), Error, 'frames');
  assertThrows(() => selectCountingFrames(candidates, [], 3, Number.NaN), Error, 'janela');
});

Deno.test('identificação preserva cobertura temporal em vez do top global de qualidade', () => {
  const candidates = countingCandidates([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  candidates.forEach((c, i) => (c.metrics.quality = i < 5 ? 0.9 : 0.2));
  const { selectedIds, primaryId } = selectIdentificationFrames(candidates, 2, 10);
  assertEquals(selectedIds.length, 2);
  assert(selectedIds.some((id) => Number(id.slice(1)) >= 5), 'uma faixa do fim do vídeo');
  assert(selectedIds.includes(primaryId));
});

Deno.test('identificação não seleciona quadros quase idênticos', () => {
  const candidates = countingCandidates([0, 1, 2, 3], true);
  const { selectedIds } = selectIdentificationFrames(candidates, 4, 4);
  assertEquals(selectedIds.length, 1);
});

Deno.test('pool de envio inclui selecionados e vizinhos, dentro do limite', () => {
  const candidates = countingCandidates([...Array(30).keys()]);
  const pool = selectUploadPool(candidates, ['c5', 'c20'], 8);
  assert(pool.includes('c5') && pool.includes('c20'));
  assertEquals(pool.length, 8);
  assert(pool.includes('c7') && pool.includes('c3') && pool.includes('c22') && pool.includes('c18'));
  assertEquals(selectUploadPool(candidates, ['c5'], 1), ['c5']);
});

Deno.test('candidatos cobrem o vídeo inteiro e respeitam o limite', () => {
  assertEquals(candidateTimes(5, 1, 120), [0, 1, 2, 3, 4, 4.9]);
  const capped = candidateTimes(60, 1, 10);
  assertEquals(capped.length, 10);
  assert(capped[capped.length - 1] > 50, 'inclui o fim');
  assert(capped.every((t, i) => i === 0 || t > capped[i - 1]), 'monotônico');
  assertEquals(candidateTimes(0, 1, 10), []);
});

Deno.test('heurísticas de qualidade detectam borrão e áreas claras', () => {
  const sharp = computeQuality(checker(320, 180, 4), null);
  const flat = computeQuality(solid(320, 180, [128, 128, 128]), null);
  assert(sharp.metrics.sharpness > flat.metrics.sharpness);
  assert(flat.warnings.some((w) => w.includes('nitidez')));
  const white = computeQuality(solid(320, 180, [255, 255, 255]), null);
  assert(white.metrics.glare > 0.9);
  assert(white.warnings.some((w) => w.includes('reflexos')));
  const moved = computeQuality(solid(320, 180, [20, 20, 20]), white.motionThumb);
  assert(moved.metrics.motion > 0.12);
});

Deno.test('similaridade exige cor e estrutura próximas', () => {
  const a = computeFingerprint(checker(160, 90, 8));
  const b = computeFingerprint(checker(160, 90, 8));
  const c = computeFingerprint(solid(160, 90, [200, 30, 30]));
  assert(areSimilar(a, b));
  assert(!areSimilar(a, c));
});
