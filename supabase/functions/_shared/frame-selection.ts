/**
 * Seleção de quadros do vídeo, portada do antigo backend Python (video.py, OpenCV).
 *
 * Código puro, sem imports: roda no celular (React Native, via metro.config.js)
 * e na Edge Function (Deno). O celular decodifica os quadros e calcula as
 * métricas; a Edge Function só reutiliza os metadados para escolher os quadros
 * da etapa de contagem.
 *
 * As pontuações de qualidade são heurísticas não calibradas. A similaridade de
 * imagem só evita enviar imagens redundantes ao modelo: nunca identifica nem
 * deduplica produtos físicos.
 */

export const SELECTION_VERSION = 'device-temporal-v1';

export interface FrameMetrics {
  sharpness: number;
  exposure: number;
  motion: number;
  glare: number;
  quality: number;
}

/** Miniatura RGB 32x18 (hex) + difference hash 9x8 (hex, 64 bits). */
export interface Fingerprint {
  thumb: string;
  dhash: string;
}

export interface FrameCandidate {
  id: string;
  timestamp_seconds: number;
  metrics: FrameMetrics;
  warnings: string[];
  fingerprint: Fingerprint;
  selection_reason?: string;
}

export interface RgbaImage {
  data: Uint8Array;
  width: number;
  height: number;
}

export const THUMB_WIDTH = 32;
export const THUMB_HEIGHT = 18;
const MOTION_WIDTH = 160;
const MOTION_HEIGHT = 90;

// ---------------------------------------------------------------------------
// Utilidades numéricas
// ---------------------------------------------------------------------------

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

/** np.linspace(start, stop, count) */
export function linspace(start: number, stop: number, count: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [start];
  const step = (stop - start) / (count - 1);
  return Array.from({ length: count }, (_, i) => start + step * i);
}

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

// ---------------------------------------------------------------------------
// Processamento de imagem
// ---------------------------------------------------------------------------

/** Tons de cinza (BT.601, como cv2.COLOR_BGR2GRAY). */
export function toGray(image: RgbaImage): Float32Array {
  const { data, width, height } = image;
  const gray = new Float32Array(width * height);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  }
  return gray;
}

/** Redução por média de blocos (aproxima cv2.INTER_AREA). */
export function resizeArea(
  src: ArrayLike<number>,
  width: number,
  height: number,
  channels: number,
  targetWidth: number,
  targetHeight: number,
  stride = channels,
): Float32Array {
  const out = new Float32Array(targetWidth * targetHeight * channels);
  for (let ty = 0; ty < targetHeight; ty++) {
    const y0 = Math.floor((ty * height) / targetHeight);
    const y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * height) / targetHeight));
    for (let tx = 0; tx < targetWidth; tx++) {
      const x0 = Math.floor((tx * width) / targetWidth);
      const x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * width) / targetWidth));
      const count = (y1 - y0) * (x1 - x0);
      for (let c = 0; c < channels; c++) {
        let sum = 0;
        for (let y = y0; y < y1; y++) {
          let p = (y * width + x0) * stride + c;
          for (let x = x0; x < x1; x++, p += stride) sum += src[p];
        }
        out[(ty * targetWidth + tx) * channels + c] = sum / count;
      }
    }
  }
  return out;
}

/** Variância do Laplaciano 3x3 (cv2.Laplacian, ksize=1), ignorando a borda. */
export function laplacianVariance(gray: Float32Array, width: number, height: number): number {
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const v = gray[i - width] + gray[i + width] + gray[i - 1] + gray[i + 1] - 4 * gray[i];
      sum += v;
      sumSq += v * v;
      n++;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  return Math.max(0, sumSq / n - mean * mean);
}

/** Cinza 160x90 usado para medir movimento entre quadros consecutivos. */
export function motionThumbnail(image: RgbaImage): Float32Array {
  return resizeArea(toGray(image), image.width, image.height, 1, MOTION_WIDTH, MOTION_HEIGHT);
}

export function computeFingerprint(image: RgbaImage): Fingerprint {
  const { data, width, height } = image;
  const rgb = resizeArea(data, width, height, 3, THUMB_WIDTH, THUMB_HEIGHT, 4);
  const thumb = new Uint8Array(rgb.length);
  for (let i = 0; i < rgb.length; i++) thumb[i] = Math.round(rgb[i]);

  const small = resizeArea(toGray(image), width, height, 1, 9, 8);
  const hash = new Uint8Array(8);
  for (let y = 0; y < 8; y++) {
    let byte = 0;
    for (let x = 0; x < 8; x++) {
      if (small[y * 9 + x + 1] > small[y * 9 + x]) byte |= 1 << x;
    }
    hash[y] = byte;
  }
  return { thumb: toHex(thumb), dhash: toHex(hash) };
}

/**
 * Conservador de propósito: diferença média de cor <= 3/255 E distância de
 * Hamming do difference hash <= 3/64 (mesmos limites de video.py).
 */
export function areSimilar(a: Fingerprint, b: Fingerprint): boolean {
  const ta = fromHex(a.thumb);
  const tb = fromHex(b.thumb);
  if (ta.length === 0 || ta.length !== tb.length) return false;
  let diff = 0;
  for (let i = 0; i < ta.length; i++) diff += Math.abs(ta[i] - tb[i]);
  if (diff / ta.length > 3.0) return false;
  const ha = fromHex(a.dhash);
  const hb = fromHex(b.dhash);
  let hamming = 0;
  for (let i = 0; i < Math.min(ha.length, hb.length); i++) {
    let x = ha[i] ^ hb[i];
    while (x) {
      hamming += x & 1;
      x >>= 1;
    }
  }
  return hamming <= 3;
}

/**
 * Métricas de qualidade de um quadro (port de video._quality). `image` já deve
 * estar reduzida (lado maior ~640 px no celular).
 */
export function computeQuality(
  image: RgbaImage,
  previousMotion: Float32Array | null,
): { metrics: FrameMetrics; warnings: string[]; motionThumb: Float32Array } {
  const { data, width, height } = image;
  const gray = toGray(image);
  const sharpness = laplacianVariance(gray, width, height);

  let clippedCount = 0;
  let graySum = 0;
  let glareCount = 0;
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    const g = gray[i];
    graySum += g;
    if (g <= 12 || g >= 244) clippedCount++;
    const r = data[p];
    const gg = data[p + 1];
    const b = data[p + 2];
    const v = Math.max(r, gg, b);
    const min = Math.min(r, gg, b);
    const s = v === 0 ? 0 : ((v - min) * 255) / v;
    if (v >= 245 && s <= 35) glareCount++;
  }
  const pixels = Math.max(1, gray.length);
  const clipped = clippedCount / pixels;
  const brightness = graySum / pixels / 255;
  const exposure = Math.max(0, (1 - clipped) * (1 - Math.abs(brightness - 0.5)));
  const glare = glareCount / pixels;

  const motionThumb = resizeArea(gray, width, height, 1, MOTION_WIDTH, MOTION_HEIGHT);
  let motion = 0;
  if (previousMotion && previousMotion.length === motionThumb.length) {
    let diff = 0;
    for (let i = 0; i < motionThumb.length; i++) diff += Math.abs(motionThumb[i] - previousMotion[i]);
    motion = diff / motionThumb.length / 255;
  }

  const normalizedSharpness = Math.min(1, Math.log1p(sharpness) / Math.log1p(1000));
  const quality = 0.5 * normalizedSharpness + 0.3 * exposure + 0.1 * (1 - motion) + 0.1 * (1 - glare);

  const warnings: string[] = [];
  if (sharpness < 60) warnings.push('Possível falta de nitidez; confira os rótulos.');
  if (exposure < 0.55) warnings.push('Possível exposição inadequada ou áreas sem detalhe.');
  if (motion > 0.12) warnings.push('Mudança visual rápida entre frames; confira movimento e borrão.');
  if (glare > 0.08) warnings.push('Áreas claras podem ser reflexos ou partes brancas da embalagem.');

  return {
    metrics: {
      sharpness: round6(sharpness),
      exposure: round6(exposure),
      motion: round6(motion),
      glare: round6(glare),
      quality: round6(quality),
    },
    warnings,
    motionThumb,
  };
}

// ---------------------------------------------------------------------------
// Seleção
// ---------------------------------------------------------------------------

/**
 * Instantes (s) dos candidatos: `sampleHz` por segundo, reduzido para caber em
 * `maxCandidates`, sempre incluindo o fim do vídeo.
 */
export function candidateTimes(durationSeconds: number, sampleHz: number, maxCandidates: number): number[] {
  if (!(durationSeconds > 0) || !(sampleHz > 0) || maxCandidates < 1) return [];
  const interval = Math.max(1 / sampleHz, durationSeconds / Math.max(1, maxCandidates - 1));
  // Último quadro decodificável fica um pouco antes do fim declarado.
  const last = Math.max(0, durationSeconds - Math.min(0.1, durationSeconds / 10));
  const times: number[] = [];
  for (let t = 0; t <= last + 1e-6 && times.length < maxCandidates; t += interval) {
    times.push(round6(t));
  }
  if (times.length < maxCandidates && last - times[times.length - 1] > 1e-6) {
    times.push(round6(last));
  }
  return times;
}

export function frameId(index: number): string {
  return `f${String(index + 1).padStart(4, '0')}`;
}

/**
 * Melhor qualidade por faixa temporal, sem imagens quase idênticas
 * (port de video._select). Retorna os IDs escolhidos e o principal sugerido.
 */
export function selectIdentificationFrames(
  candidates: FrameCandidate[],
  maxFrames: number,
  durationSeconds: number,
): { selectedIds: string[]; primaryId: string } {
  if (candidates.length === 0) throw new Error('Nenhum frame legível encontrado no vídeo.');
  const duration = Math.max(durationSeconds, 0.001);
  const count = Math.min(maxFrames, candidates.length);
  const selected: FrameCandidate[] = [];
  for (let bin = 0; bin < count; bin++) {
    const pool = candidates
      .filter((c) => Math.min(count - 1, Math.floor((c.timestamp_seconds / duration) * count)) === bin)
      .sort((a, b) => b.metrics.quality - a.metrics.quality);
    for (const candidate of pool) {
      const duplicate = selected.find((item) => areSimilar(candidate.fingerprint, item.fingerprint));
      if (duplicate) {
        candidate.selection_reason = `Imagem quase idêntica a ${duplicate.id}; não identifica produtos repetidos.`;
        continue;
      }
      candidate.selection_reason =
        `Melhor qualidade disponível na faixa temporal ${bin + 1}/${count}, sem imagem quase idêntica já selecionada.`;
      selected.push(candidate);
      break;
    }
  }
  if (selected.length === 0) selected.push(candidates[0]);
  const primary = selected.reduce((best, item) => {
    const score = (c: FrameCandidate) => c.metrics.quality - 0.08 * Math.abs(c.timestamp_seconds / duration - 0.5);
    return score(item) > score(best) ? item : best;
  });
  primary.selection_reason =
    (primary.selection_reason ?? '') +
    ' Principal sugerido por qualidade; outros ângulos podem revelar unidades adicionais.';
  return { selectedIds: selected.map((c) => c.id), primaryId: primary.id };
}

/**
 * Quadros que o celular envia além dos de identificação: vizinhos a ±2/4/6 s de
 * cada quadro selecionado, para que a etapa de contagem possa examinar topos e
 * laterais (o servidor não tem o vídeo). Ordem de prioridade: distância menor
 * primeiro, alternando entre os quadros selecionados.
 */
export function selectUploadPool(
  candidates: FrameCandidate[],
  selectedIds: string[],
  maxFrames: number,
  contextSeconds = 6,
): string[] {
  const ordered = [...candidates].sort((a, b) => a.timestamp_seconds - b.timestamp_seconds);
  const byId = new Map(ordered.map((c) => [c.id, c]));
  const pool: FrameCandidate[] = selectedIds.map((id) => byId.get(id)).filter((c): c is FrameCandidate => !!c);
  const anchors = [...pool];
  const step = Math.min(2, contextSeconds);
  for (let distance = step; distance <= contextSeconds + step / 2 && pool.length < maxFrames; distance += step) {
    for (const direction of [1, -1]) {
      for (const anchor of anchors) {
        if (pool.length >= maxFrames) break;
        const target = anchor.timestamp_seconds + direction * distance;
        const near = ordered
          .filter((c) => Math.abs(c.timestamp_seconds - target) <= step / 2)
          .sort((a, b) =>
            Math.abs(a.timestamp_seconds - target) - 0.3 * clamp01(a.metrics.quality) -
            (Math.abs(b.timestamp_seconds - target) - 0.3 * clamp01(b.metrics.quality))
          );
        const pick = near.find(
          (c) => !pool.some((p) => p.id === c.id || areSimilar(p.fingerprint, c.fingerprint)),
        );
        if (pick) pool.push(pick);
      }
    }
  }
  return pool.sort((a, b) => a.timestamp_seconds - b.timestamp_seconds).map((c) => c.id);
}

/**
 * Mantém as âncoras de reconhecimento e amostra as vistas imediatamente ao
 * redor delas (port de video.select_counting_frames). Roda na Edge Function
 * sobre os quadros enviados pelo celular.
 */
export function selectCountingFrames<T extends FrameCandidate>(
  candidates: T[],
  evidenceFrameIds: string[],
  maxFrames: number,
  contextSeconds = 6,
): T[] {
  if (!Number.isInteger(maxFrames) || maxFrames < 1 || maxFrames > 500) {
    throw new Error('Use entre 1 e 500 frames para conferir a contagem.');
  }
  if (!(contextSeconds > 0)) throw new Error('A janela de contexto deve ser positiva e finita.');
  if (candidates.length === 0) {
    if (evidenceFrameIds.length) throw new Error('Frame de evidência não encontrado entre os candidatos.');
    return [];
  }
  const ordered = candidates.map((c) => ({ ...c })).sort((a, b) => a.timestamp_seconds - b.timestamp_seconds);
  const byId = new Map(ordered.map((c) => [c.id, c]));
  if (byId.size !== ordered.length || evidenceFrameIds.some((id) => !byId.has(id))) {
    throw new Error('Frame de evidência desconhecido ou identificador de frame repetido.');
  }
  const evidence = new Set(evidenceFrameIds);
  const anchors = ordered.filter((c) => evidence.has(c.id));
  const selected: T[] = [];

  const append = (item: T, reason: string, anchor = false): boolean => {
    if (selected.length >= maxFrames || selected.some((other) => other.id === item.id)) return false;
    if (!anchor && selected.some((other) => areSimilar(item.fingerprint, other.fingerprint))) return false;
    item.selection_reason = reason;
    selected.push(item);
    return true;
  };
  const quality = (item: T) => clamp01(item.metrics?.quality ?? 0);
  const around = (target: number, pool: T[], reason: string) => {
    const sorted = [...pool].sort((a, b) => {
      const ka = Math.abs(a.timestamp_seconds - target) - 0.3 * quality(a);
      const kb = Math.abs(b.timestamp_seconds - target) - 0.3 * quality(b);
      return ka - kb || a.timestamp_seconds - b.timestamp_seconds;
    });
    for (const item of sorted) if (append(item, reason)) break;
  };
  const byTime = (a: T, b: T) => a.timestamp_seconds - b.timestamp_seconds;

  const first = ordered[0].timestamp_seconds;
  const last = ordered[ordered.length - 1].timestamp_seconds;

  if (anchors.length === 0) {
    for (const target of linspace(first, last, Math.min(maxFrames, ordered.length))) {
      around(target, ordered, 'Cobertura temporal adicional; reconhecimento ainda sem frame de evidência específico.');
    }
    return selected.sort(byTime);
  }

  const indices = linspace(0, anchors.length - 1, Math.min(anchors.length, maxFrames)).map((x) => Math.trunc(x));
  for (const index of indices) {
    append(anchors[index], 'Evidência de reconhecimento preservada para comparar a embalagem nos outros ângulos.', true);
  }
  const local = ordered.filter((item) =>
    anchors.some((anchor) => Math.abs(item.timestamp_seconds - anchor.timestamp_seconds) <= contextSeconds)
  );
  const step = Math.min(2, contextSeconds);
  for (let distance = step; distance < contextSeconds + step / 2; distance += step) {
    for (const direction of [1, -1]) {
      for (const anchor of anchors) {
        const target = Math.max(first, Math.min(last, anchor.timestamp_seconds + direction * distance));
        if (selected.some((item) => Math.abs(item.timestamp_seconds - target) < step / 2)) continue;
        const pool = local.filter((item) => Math.abs(item.timestamp_seconds - target) <= step / 2);
        around(
          target,
          pool,
          `Complemento próximo de ${target.toFixed(1)} s para conferir topo/laterais ao redor de ${anchor.id}; não comprova novas unidades.`,
        );
      }
    }
  }
  const chosen = () => new Set(selected.map((item) => item.id));
  const remaining = local.filter((item) => !chosen().has(item.id));
  while (remaining.length && selected.length < maxFrames) {
    let bestIndex = 0;
    let bestKey = -Infinity;
    let bestTime = -Infinity;
    remaining.forEach((item, index) => {
      const distance = Math.min(...selected.map((c) => Math.abs(item.timestamp_seconds - c.timestamp_seconds)));
      const key = distance + 0.3 * quality(item);
      if (key > bestKey || (key === bestKey && item.timestamp_seconds > bestTime)) {
        bestKey = key;
        bestTime = item.timestamp_seconds;
        bestIndex = index;
      }
    });
    const [item] = remaining.splice(bestIndex, 1);
    append(item, 'Complemento com maior distância temporal local para conferir unidades encobertas na vista frontal.');
  }
  return selected.sort(byTime);
}
