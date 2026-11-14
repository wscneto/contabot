/**
 * Acesso ao Supabase. Cada método corresponde a um endpoint do antigo backend
 * FastAPI e devolve o mesmo formato (as RPCs SQL montam o JSON); caminhos de
 * mídia do bucket privado "media" são trocados por URLs assinadas.
 */
import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { encodeJpeg } from './images';

const MEDIA_BUCKET = 'media';
const SIGNED_URL_SECONDS = 60 * 60;
const PRODUCT_PHOTO_MAX_DIMENSION = 1920;

// Caminho de mídia: {store_id}/{products|captures}/...
const MEDIA_PATH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(products|captures)\/.+/i;

const signedCache = new Map<string, { url: string; expiresAt: number }>();

function collectMediaPaths(value: unknown, out: Set<string>) {
  if (typeof value === 'string') {
    if (MEDIA_PATH.test(value)) out.add(value);
  } else if (Array.isArray(value)) {
    value.forEach((v) => collectMediaPaths(v, out));
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach((v) => collectMediaPaths(v, out));
  }
}

function replaceMediaPaths<T>(value: T): T {
  if (typeof value === 'string') {
    return (signedCache.get(value)?.url ?? value) as T;
  }
  if (Array.isArray(value)) return value.map(replaceMediaPaths) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, replaceMediaPaths(v)])) as T;
  }
  return value;
}

/** Troca caminhos do bucket por URLs assinadas (em lote, com cache em memória). */
async function withSignedMedia<T>(value: T): Promise<T> {
  const paths = new Set<string>();
  collectMediaPaths(value, paths);
  const now = Date.now();
  // Renova com folga de 5 min para a URL não expirar com a tela aberta.
  const missing = [...paths].filter((p) => (signedCache.get(p)?.expiresAt ?? 0) - 5 * 60_000 < now);
  if (missing.length) {
    const { data, error } = await supabase.storage.from(MEDIA_BUCKET).createSignedUrls(missing, SIGNED_URL_SECONDS);
    if (error) console.warn('[API] Falha ao assinar mídias:', error.message);
    for (const entry of data ?? []) {
      if (entry.signedUrl && entry.path) {
        signedCache.set(entry.path, { url: entry.signedUrl, expiresAt: now + SIGNED_URL_SECONDS * 1000 });
      }
    }
  }
  return replaceMediaPaths(value);
}

async function rpc<T = any>(fn: string, args: Record<string, unknown> = {}, sign = true): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    console.warn(`[API] ${fn}:`, error.message);
    if (error.message?.includes('Failed to fetch') || error.message?.includes('Network request failed')) {
      throw new Error('Não foi possível conectar ao servidor. Verifique sua conexão.');
    }
    throw new Error(error.message || 'Ocorreu um erro ao processar sua requisição.');
  }
  return sign ? withSignedMedia(data as T) : (data as T);
}

async function invoke<T = any>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const detail = await error.context.json().catch(() => null);
      throw new Error(detail?.detail || 'Ocorreu um erro ao processar sua requisição.');
    }
    throw new Error('Não foi possível conectar ao servidor. Verifique sua conexão.');
  }
  return data as T;
}

async function uploadJpeg(path: string, bytes: Uint8Array): Promise<void> {
  const { error } = await supabase.storage.from(MEDIA_BUCKET).upload(path, bytes, {
    contentType: 'image/jpeg',
    upsert: false,
  });
  if (error) throw new Error(`Falha ao enviar imagem: ${error.message}`);
}

function randomId(): string {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function uploadProductPhotos(storeId: string, uris: string[]): Promise<string[]> {
  const paths: string[] = [];
  for (const uri of uris) {
    const { bytes } = await encodeJpeg(uri, PRODUCT_PHOTO_MAX_DIMENSION);
    const path = `${storeId}/products/${randomId()}.jpg`;
    await uploadJpeg(path, bytes);
    paths.push(path);
  }
  return paths;
}

export interface ProductInput {
  name: string;
  variant?: string;
  barcode?: string;
  min_stock?: number | null;
  photoUris: string[];
}

export interface ImportProductItem {
  name: string;
  variant?: string;
  barcode?: string;
  min_stock?: number | null;
}

export const api = {
  /** URL já assinada pelas consultas; mantido para as telas exibirem imagens. */
  resolveMediaUrl(url: string | null | undefined): string | null {
    return url || null;
  },

  // ----- Sessão e equipe -----
  whoami: () => rpc('whoami', {}, false),
  listTeam: () => rpc('list_team'),
  createEmployee: (name: string) => invoke<{ user: any; access_code: string }>('create-employee', { name }),
  regenerateAccessCode: (userId: string) => rpc('regenerate_access_code', { p_user_id: userId }),
  deactivateMember: (userId: string) => rpc('deactivate_member', { p_user_id: userId }),
  joinWithCode: (code: string) => invoke<{ token_hash: string }>('join-store', { code }),

  // ----- Produtos -----
  listProducts: () => rpc('list_products'),
  getProduct: (id: string) => rpc('get_product', { p_id: id }),
  async createProduct(storeId: string, input: ProductInput) {
    if (input.photoUris.length < 1 || input.photoUris.length > 4) {
      throw new Error('Envie de 1 a 4 fotos do produto.');
    }
    const photos = await uploadProductPhotos(storeId, input.photoUris);
    return rpc('create_product', {
      p_name: input.name,
      p_variant: input.variant ?? '',
      p_barcode: input.barcode ?? '',
      p_min_stock: input.min_stock ?? null,
      p_photos: photos,
    });
  },
  async updateProduct(storeId: string, id: string, input: Partial<ProductInput>) {
    const photos = input.photoUris?.length ? await uploadProductPhotos(storeId, input.photoUris) : null;
    return rpc('update_product', {
      p_id: id,
      p_name: input.name ?? null,
      p_variant: input.variant ?? null,
      p_barcode: input.barcode ?? null,
      p_min_stock: input.min_stock ?? null,
      p_photos: photos,
    });
  },
  archiveProduct: (id: string) => rpc('archive_product', { p_id: id }),
  importProducts: (items: ImportProductItem[]) =>
    rpc<{ count: number; products: any[] }>('import_products', { p_items: items }),

  // ----- Áreas -----
  listAreas: () => rpc('list_areas'),
  getArea: (id: string) => rpc('get_area', { p_id: id }),
  createArea: (input: { name: string; description?: string; product_ids: string[] }) =>
    rpc('create_area', {
      p_name: input.name,
      p_description: input.description ?? '',
      p_product_ids: input.product_ids,
    }),
  updateArea: (id: string, input: { name?: string; description?: string; product_ids?: string[] }) =>
    rpc('update_area', {
      p_id: id,
      p_name: input.name ?? null,
      p_description: input.description ?? null,
      p_product_ids: input.product_ids ?? null,
    }),
  deleteArea: (id: string) => rpc('delete_area', { p_id: id }),

  // ----- Contagens -----
  listTasks: (scope: 'mine' | 'all' = 'mine', statuses?: string[]) =>
    rpc('list_tasks', { p_scope: scope, p_statuses: statuses ?? null }),
  getTask: (id: string) => rpc('get_task', { p_id: id }),
  createTasks: (input: { area_ids: string[]; assignee_id?: string | null; due_date?: string | null; note?: string }) =>
    rpc('create_tasks', {
      p_area_ids: input.area_ids,
      p_assignee_id: input.assignee_id ?? null,
      p_due_date: input.due_date ?? null,
      p_note: input.note ?? '',
    }),
  updateTask: (id: string, patch: { assignee_id?: string | null; due_date?: string | null; note?: string }) =>
    rpc('update_task', { p_id: id, p_patch: patch }),
  deleteTask: (id: string) => rpc('delete_task', { p_id: id }),
  switchToManual: (id: string) => rpc('switch_to_manual', { p_id: id }),
  submitTask: (id: string, counts: Record<string, number | null>) =>
    rpc('submit_task', { p_id: id, p_counts: counts }),
  approveTask: (id: string, counts?: Record<string, number | null>) =>
    rpc('approve_task', { p_id: id, p_counts: counts ?? null }),
  requestRecount: (id: string, note: string) => rpc('request_recount', { p_id: id, p_note: note }),
  getDashboard: () => rpc('get_dashboard'),

  // ----- Capturas (ver services/capture.ts) -----
  startCapture: (taskId: string) =>
    rpc<{ capture_id: string; upload_prefix: string }>('start_capture', { p_task_id: taskId }, false),
  uploadFrame: (path: string, bytes: Uint8Array) => uploadJpeg(path, bytes),
  registerCaptureFrames: (
    captureId: string,
    frames: Record<string, unknown>[],
    selectedFrameIds: string[],
    primaryFrameId: string,
    selection: Record<string, unknown>,
  ) =>
    rpc('register_capture_frames', {
      p_capture_id: captureId,
      p_frames: frames,
      p_selected_frame_ids: selectedFrameIds,
      p_primary_frame_id: primaryFrameId,
      p_selection: selection,
    }, false),
  failCapture: (captureId: string, error: string) =>
    rpc('fail_capture', { p_capture_id: captureId, p_error: error }),
  analyzeCapture: (captureId: string) => invoke('analyze-capture', { capture_id: captureId }),
};
