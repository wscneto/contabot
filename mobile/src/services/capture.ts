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

async function runCapture(taskId: string, videoUri: string, emit: (p: CaptureProgress) => void): Promise<void> {
  const { capture_id: captureId, upload_prefix: uploadPrefix } = await api.startCapture(taskId);
  let player: VideoPlayer | null = null;
  try {
    if (Platform.OS === 'web') {
      throw new Error('A análise de vídeo funciona apenas no app Android/iOS. Faça a conferência manual.');
    }
    emit({ phase: 'preparing', done: 0, total: 0 });
    player = createVideoPlayer(videoUri);
    player.muted = true;
    await waitUntilReady(player);
    const duration = player.duration;
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
      const thumbnails = await player.generateThumbnailsAsync(batch, {
        maxWidth: CAPTURE_SETTINGS.analysisMaxDimension,
        maxHeight: CAPTURE_SETTINGS.analysisMaxDimension,
      });
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
      const [thumbnail] = await player.generateThumbnailsAsync([candidate.timestamp_seconds], {
        maxWidth: CAPTURE_SETTINGS.uploadMaxDimension,
        maxHeight: CAPTURE_SETTINGS.uploadMaxDimension,
      });
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
  }
}
