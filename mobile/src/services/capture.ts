/**
 * Seleção de quadros no próprio celular (substitui o OpenCV/FFmpeg do servidor).
 *
 * 1. cria a captura (RPC start_capture);
 * 2. extrai ~1 quadro/s com expo-video, reduz para 640 px e calcula nitidez,
 *    exposição, movimento, reflexo e assinatura de similaridade;
 * 3. escolhe os quadros de identificação e os vizinhos úteis para a contagem;
 * 4. envia só esses quadros (JPEG 1920 px) ao Storage e registra os metadados;
 * 5. chama a Edge Function analyze-capture, que roda o modelo no servidor.
 *
 * Qualquer falha marca a captura como falha (a contagem vai para conferência
 * manual), como fazia o backend antigo.
 */
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { createVideoPlayer, type VideoPlayer } from 'expo-video';
import { decode as decodeJpeg } from 'jpeg-js';
import {
  candidateTimes,
  computeFingerprint,
  computeQuality,
  frameId,
  type FrameCandidate,
  type RgbaImage,
  SELECTION_VERSION,
  selectIdentificationFrames,
  selectUploadPool,
} from '../../../supabase/functions/_shared/frame-selection';
import { api } from './api';
import { encodeJpeg } from './images';

export const CAPTURE_SETTINGS = {
  sampleHz: 1,
  maxCandidates: 120,
  maxIdentificationFrames: 5,
  /** Quadros enviados ao servidor (identificação + vizinhos para a contagem). */
  maxUploadFrames: 20,
  analysisMaxDimension: 640,
  uploadMaxDimension: 1920,
  uploadQuality: 0.85,
  maxDurationSeconds: 180,
  thumbnailBatch: 4,
};

export type CapturePhase = 'preparing' | 'scoring' | 'uploading' | 'analyzing' | 'done' | 'failed';

export interface CaptureProgress {
  phase: CapturePhase;
  done: number;
  total: number;
  error?: string;
}

type Listener = (progress: CaptureProgress) => void;

interface CaptureJob {
  taskId: string;
  progress: CaptureProgress;
  listeners: Set<Listener>;
  promise: Promise<void>;
}

const jobs = new Map<string, CaptureJob>();

/** Progresso atual do envio de uma contagem, se houver um em andamento. */
export function getCaptureJob(taskId: string): CaptureJob | undefined {
  return jobs.get(taskId);
}

export function subscribeCaptureJob(taskId: string, listener: Listener): () => void {
  const job = jobs.get(taskId);
  if (!job) return () => undefined;
  job.listeners.add(listener);
  listener(job.progress);
  return () => job.listeners.delete(listener);
}

/**
 * Inicia (ou reaproveita) o processamento do vídeo de uma contagem. Roda fora
 * do ciclo de vida das telas: trocar de tela não interrompe o envio.
 */
export function startCaptureJob(taskId: string, videoUri: string): CaptureJob {
  const existing = jobs.get(taskId);
  if (existing && existing.progress.phase !== 'done' && existing.progress.phase !== 'failed') return existing;

  const job: CaptureJob = {
    taskId,
    progress: { phase: 'preparing', done: 0, total: 0 },
    listeners: new Set(),
    promise: Promise.resolve(),
  };
  const emit = (progress: CaptureProgress) => {
    job.progress = progress;
    job.listeners.forEach((listener) => listener(progress));
  };
  job.promise = runCapture(taskId, videoUri, emit).then(
    () => emit({ phase: 'done', done: 1, total: 1 }),
    (error) => emit({ phase: 'failed', done: 0, total: 0, error: messageOf(error) }),
  );
  jobs.set(taskId, job);
  return job;
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Falha ao processar o vídeo.';
}

function waitUntilReady(player: VideoPlayer, timeoutMs = 20_000): Promise<void> {
  if (player.status === 'readyToPlay') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      subscription.remove();
      reject(new Error('Não foi possível abrir o vídeo no aparelho.'));
    }, timeoutMs);
    const subscription = player.addListener('statusChange', ({ status, error }) => {
      if (status === 'readyToPlay') {
        clearTimeout(timer);
        subscription.remove();
        resolve();
      } else if (status === 'error') {
        clearTimeout(timer);
        subscription.remove();
        reject(new Error(error?.message ? `Vídeo ilegível: ${error.message}` : 'Vídeo ilegível.'));
      }
    });
  });
}

async function decodeForAnalysis(thumbnail: Parameters<typeof encodeJpeg>[0]): Promise<RgbaImage> {
  const { bytes } = await encodeJpeg(thumbnail, CAPTURE_SETTINGS.analysisMaxDimension, 0.92);
  const decoded = decodeJpeg(bytes, { useTArray: true, formatAsRGBA: true });
  return { data: decoded.data as Uint8Array, width: decoded.width, height: decoded.height };
}

/**
 * Garante que o vídeo existe em um caminho acessível pelo expo-video.
 *
 * No Android, `CameraView.recordAsync()` pode devolver um URI cujo arquivo é
 * removido pelo sistema antes de o `createVideoPlayer` abri-lo (ex.: cache
 * temporário do DocumentPicker ou do provedor de mídia). Copiamos o vídeo para
 * o documentDirectory/cacheDirectory do app, que é estável durante a sessão.
 */
export function normalizeVideoUri(videoUri: string): string {
  let uri = videoUri.trim();
  if (uri.startsWith('content://') || uri.startsWith('http://') || uri.startsWith('https://')) {
    return uri;
  }
  if (!uri.startsWith('file://')) {
    uri = `file://${uri.startsWith('/') ? '' : '/'}${uri}`;
  } else if (!uri.startsWith('file:///')) {
    uri = uri.replace('file://', 'file:///');
  }
  return uri;
}

export function prepareVideoUriCandidates(videoUri: string): string[] {
  const normalized = normalizeVideoUri(videoUri);
  const candidates: string[] = [];

  // Se tem %25 (dupla codificação de URL, ex: %2540 em vez de %40 no Expo Go),
  // decodifica para o caminho real no disco do Android (primeira prioridade para MediaMetadataRetriever)
  if (normalized.includes('%25')) {
    try {
      const decodedOnce = decodeURI(normalized);
      if (!candidates.includes(decodedOnce)) {
        candidates.push(decodedOnce);
      }
    } catch {
      // ignore
    }
  }

  // Caminho normalizado
  if (!candidates.includes(normalized)) {
    candidates.push(normalized);
  }

  // Caminho totalmente decodificado (caso o sistema use caracteres desescapados)
  try {
    const decodedFull = decodeURIComponent(normalized);
    if (!candidates.includes(decodedFull)) {
      candidates.push(decodedFull);
    }
  } catch {
    // ignore
  }

  return candidates;
}

async function createPlayerForVideo(videoUri: string): Promise<{ player: VideoPlayer; duration: number }> {
  const candidates = prepareVideoUriCandidates(videoUri);
  let lastError: unknown = null;

  for (const uri of candidates) {
    let p: VideoPlayer | null = null;
    try {
      p = createVideoPlayer(uri);
      p.muted = true;
      await waitUntilReady(p);
      const d = p.duration;
      if (d > 0) {
        // Valida se o MediaMetadataRetriever nativo consegue ler este caminho gerando um thumbnail de teste
        const testThumbs = await p.generateThumbnailsAsync([0], { maxWidth: 64, maxHeight: 64 });
        if (testThumbs && testThumbs.length > 0) {
          testThumbs.forEach((t) => t.release());
        }
        return { player: p, duration: d };
      }
      p.release();
    } catch (err) {
      console.warn(`[Capture] Candidato de URI falhou (${uri}):`, err);
      p?.release();
      lastError = err;
    }
  }

  throw lastError || new Error('Não foi possível inicializar o reprodutor de vídeo.');
}

export async function ensureVideoAccessible(videoUri: string): Promise<string> {
  if (Platform.OS === 'web') return videoUri;

  const normalizedUri = normalizeVideoUri(videoUri);

  // 1. Tenta o caminho normalizado
  try {
    const info = await FileSystem.getInfoAsync(normalizedUri);
    if (info.exists && (info.size ?? 0) > 0) return normalizedUri;
  } catch {
    // ignorar e tentar alternativas
  }

  // 2. Se o caminho possui caracteres com percent-encoding, tenta a versão decodificada
  try {
    const decoded = decodeURI(normalizedUri);
    if (decoded !== normalizedUri) {
      const decodedInfo = await FileSystem.getInfoAsync(decoded);
      if (decodedInfo.exists && (decodedInfo.size ?? 0) > 0) return decoded;
    }
  } catch {
    // ignorar
  }

  // 3. Tenta copiar do URI de entrada para um arquivo seguro no documentDirectory ou cacheDirectory
  const targetDir = FileSystem.documentDirectory || FileSystem.cacheDirectory;
  const destPath = `${targetDir}capture_proc_${Date.now()}.mp4`;
  try {
    await FileSystem.copyAsync({ from: videoUri, to: destPath });
    const destInfo = await FileSystem.getInfoAsync(destPath);
    if (destInfo.exists && (destInfo.size ?? 0) > 0) return destPath;
  } catch {
    // Falha na cópia — o URI original pode já ser inválido.
  }

  throw new Error(
    'O arquivo de vídeo não foi encontrado ou está inacessível. Isso pode ocorrer se o sistema limpou o cache. Grave a filmagem novamente.',
  );
}

async function runCapture(taskId: string, videoUri: string, emit: (p: CaptureProgress) => void): Promise<void> {
  const { capture_id: captureId, upload_prefix: uploadPrefix } = await api.startCapture(taskId);
  let player: VideoPlayer | null = null;
  let stableVideoUri: string | null = null;
  try {
    if (Platform.OS === 'web') {
      throw new Error('A análise de vídeo funciona apenas no app Android/iOS. Faça a conferência manual.');
    }
    emit({ phase: 'preparing', done: 0, total: 0 });

    // Garante que o vídeo é acessível antes de criar o player e testa compatibilidade nativa de thumbnails
    stableVideoUri = await ensureVideoAccessible(videoUri);
    const playerResult = await createPlayerForVideo(stableVideoUri);
    player = playerResult.player;
    const duration = playerResult.duration;
    if (!(duration > 0)) throw new Error('O vídeo não informa duração válida; grave novamente.');
    if (duration > CAPTURE_SETTINGS.maxDurationSeconds + 0.5) {
      throw new Error(`Vídeo excede ${CAPTURE_SETTINGS.maxDurationSeconds} segundos. Filme uma seção menor.`);
    }

    // 1. Candidatos: decodifica em lotes pequenos para limitar a memória.
    const times = candidateTimes(duration, CAPTURE_SETTINGS.sampleHz, CAPTURE_SETTINGS.maxCandidates);
    const candidates: FrameCandidate[] = [];
    let previousMotion: Float32Array | null = null;
    for (let start = 0; start < times.length; start += CAPTURE_SETTINGS.thumbnailBatch) {
      const batch = times.slice(start, start + CAPTURE_SETTINGS.thumbnailBatch);
      let thumbnails;
      try {
        thumbnails = await player.generateThumbnailsAsync(batch, {
          maxWidth: CAPTURE_SETTINGS.analysisMaxDimension,
          maxHeight: CAPTURE_SETTINGS.analysisMaxDimension,
        });
      } catch (err: any) {
        console.error('[Capture] Falha em generateThumbnailsAsync:', err);
        throw new Error(
          `Falha ao extrair quadros da filmagem (${err?.message || 'arquivo inacessível'}). Grave o vídeo novamente.`,
        );
      }
      for (let i = 0; i < thumbnails.length; i++) {
        const thumbnail = thumbnails[i];
        try {
          const image = await decodeForAnalysis(thumbnail);
          const { metrics, warnings, motionThumb } = computeQuality(image, previousMotion);
          previousMotion = motionThumb;
          candidates.push({
            id: frameId(start + i),
            timestamp_seconds: batch[i],
            metrics,
            warnings,
            fingerprint: computeFingerprint(image),
            selection_reason: 'Candidato extraído para seleção automática por qualidade e cobertura temporal.',
          });
        } finally {
          thumbnail.release();
        }
      }
      emit({ phase: 'scoring', done: Math.min(times.length, start + batch.length), total: times.length });
    }
    if (!candidates.length) throw new Error('Nenhum frame legível encontrado no vídeo.');

    // 2. Seleção.
    const { selectedIds, primaryId } = selectIdentificationFrames(
      candidates,
      CAPTURE_SETTINGS.maxIdentificationFrames,
      duration,
    );
    const uploadIds = selectUploadPool(candidates, selectedIds, CAPTURE_SETTINGS.maxUploadFrames);
    const byId = new Map(candidates.map((c) => [c.id, c]));
    const toUpload = uploadIds.map((id) => byId.get(id)!);

    // 3. Envio dos quadros escolhidos em resolução cheia.
    emit({ phase: 'uploading', done: 0, total: toUpload.length });
    const frames: Record<string, unknown>[] = [];
    for (let i = 0; i < toUpload.length; i++) {
      const candidate = toUpload[i];
      let thumbnails;
      try {
        thumbnails = await player.generateThumbnailsAsync([candidate.timestamp_seconds], {
          maxWidth: CAPTURE_SETTINGS.uploadMaxDimension,
          maxHeight: CAPTURE_SETTINGS.uploadMaxDimension,
        });
      } catch (err: any) {
        console.error('[Capture] Falha em generateThumbnailsAsync (alta resolução):', err);
        throw new Error(
          `Falha ao gerar quadros em alta resolução (${err?.message || 'arquivo inacessível'}). Grave o vídeo novamente.`,
        );
      }
      const [thumbnail] = thumbnails;
      let encoded;
      try {
        encoded = await encodeJpeg(thumbnail, CAPTURE_SETTINGS.uploadMaxDimension, CAPTURE_SETTINGS.uploadQuality);
      } finally {
        thumbnail.release();
      }
      const path = `${uploadPrefix}${candidate.id}.jpg`;
      await api.uploadFrame(path, encoded.bytes);
      frames.push({ ...candidate, path, width: encoded.width, height: encoded.height });
      emit({ phase: 'uploading', done: i + 1, total: toUpload.length });
    }

    await api.registerCaptureFrames(captureId, frames, selectedIds, primaryId, {
      version: SELECTION_VERSION,
      platform: Platform.OS,
      duration_seconds: duration,
      candidates: candidates.length,
      sample_hz: CAPTURE_SETTINGS.sampleHz,
      analysis_max_dimension: CAPTURE_SETTINGS.analysisMaxDimension,
      upload_max_dimension: CAPTURE_SETTINGS.uploadMaxDimension,
      warnings: [
        'Qualidade, reflexo e cobertura temporal são heurísticas; não comprovam visibilidade de todas as unidades.',
        'Frames complementares podem repetir caixas. A seção terá uma única contagem, nunca a soma dos frames.',
      ],
    });

    // 4. Análise no servidor (identificar → contar).
    emit({ phase: 'analyzing', done: 0, total: 0 });
    await api.analyzeCapture(captureId);
  } catch (error) {
    await api.failCapture(captureId, messageOf(error)).catch(() => null);
    throw error;
  } finally {
    player?.release();
    // Limpa cópia temporária do vídeo, se foi criada.
    if (stableVideoUri && stableVideoUri !== videoUri) {
      FileSystem.deleteAsync(stableVideoUri, { idempotent: true }).catch(() => null);
    }
  }
}
