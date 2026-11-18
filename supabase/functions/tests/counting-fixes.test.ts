import { assert, assertEquals } from 'jsr:@std/assert@1';
import {
  evaluateAnalyzingState,
  IMAGE_UPLOAD_SETTINGS,
  initialReviewCounts,
  shouldAutoRedirectToReview,
} from '../_shared/frame-selection.ts';

// -------------------------------------------------------------
// Test 1: Employee Access Code copying & formatting (Item 4)
// -------------------------------------------------------------
export function formatAccessCodeForClipboard(code: string): string {
  return code.trim();
}

export function buildQrPayload(accessCode: string): string {
  return JSON.stringify({ code: accessCode.trim() });
}

// -------------------------------------------------------------
// Test 2: Video accessibility & persistence logic (Item 5)
// -------------------------------------------------------------
export interface MockFileInfo {
  exists: boolean;
  size?: number;
}

export interface MockFileSystem {
  documentDirectory: string;
  cacheDirectory: string;
  files: Map<string, MockFileInfo>;
  getInfoAsync(uri: string): Promise<MockFileInfo>;
  copyAsync(options: { from: string; to: string }): Promise<void>;
}

export function createMockFileSystem(initialFiles: Record<string, MockFileInfo> = {}): MockFileSystem {
  const files = new Map<string, MockFileInfo>(Object.entries(initialFiles));
  return {
    documentDirectory: 'file:///data/user/0/host.exp.exponent/files/',
    cacheDirectory: 'file:///data/user/0/host.exp.exponent/cache/',
    files,
    async getInfoAsync(uri: string) {
      return files.get(uri) ?? { exists: false, size: 0 };
    },
    async copyAsync({ from, to }) {
      const source = files.get(from);
      if (!source || !source.exists) {
        throw new Error(`File from ${from} does not exist`);
      }
      files.set(to, { exists: true, size: source.size ?? 1024 });
    },
  };
}

export function normalizeVideoUri(rawUri: string): string {
  let uri = rawUri.trim();
  if (!uri.startsWith('file://') && !uri.startsWith('content://') && !uri.startsWith('http://') && !uri.startsWith('https://')) {
    uri = `file://${uri.startsWith('/') ? '' : '/'}${uri}`;
  } else if (uri.startsWith('file://') && !uri.startsWith('file:///')) {
    uri = uri.replace('file://', 'file:///');
  }
  return uri;
}

export function prepareVideoUriCandidates(videoUri: string): string[] {
  const normalized = normalizeVideoUri(videoUri);
  const candidates: string[] = [];

  // Se tem %25 (dupla codificação de URL, ex: %2540 em vez de %40 no Expo Go),
  // decodifica para o caminho real no disco do Android (primeira prioridade)
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

  // Normalized path
  if (!candidates.includes(normalized)) {
    candidates.push(normalized);
  }

  // Fully decoded path
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

export async function resolveAccessibleVideoUri(
  videoUri: string,
  fs: MockFileSystem
): Promise<string> {
  const normalized = normalizeVideoUri(videoUri);

  // 1. Check normalized path
  const direct = await fs.getInfoAsync(normalized);
  if (direct.exists && (direct.size ?? 0) > 0) {
    return normalized;
  }

  // 2. Check decoded URI if URL-encoded
  try {
    const decoded = decodeURI(normalized);
    if (decoded !== normalized) {
      const decodedInfo = await fs.getInfoAsync(decoded);
      if (decodedInfo.exists && (decodedInfo.size ?? 0) > 0) {
        return decoded;
      }
    }
  } catch {
    // Ignore decode error
  }

  // 3. Fallback: try copying from original to documentDirectory
  const dest = `${fs.documentDirectory}persistent_capture.mp4`;
  try {
    await fs.copyAsync({ from: videoUri, to: dest });
    const copied = await fs.getInfoAsync(dest);
    if (copied.exists && (copied.size ?? 0) > 0) {
      return dest;
    }
  } catch {
    // Fallback failed
  }

  throw new Error('O arquivo de vídeo não foi encontrado. Grave a filmagem novamente.');
}

// -------------------------------------------------------------
// Test 3: Analyzing screen redirect guard & stale cache protection (Item 6)
// -------------------------------------------------------------

// =============================================================
// DENO TESTS
// =============================================================

Deno.test('Item 4: formatação e payload do código de acesso para cópia e QR', () => {
  const code = '  12345678  ';
  const formatted = formatAccessCodeForClipboard(code);
  assertEquals(formatted, '12345678');

  const qr = buildQrPayload(code);
  assertEquals(qr, '{"code":"12345678"}');
});

Deno.test('Item 5: normaliza caminhos de vídeo com ou sem scheme file://', () => {
  assertEquals(
    normalizeVideoUri('/data/user/0/cache/Camera/video.mp4'),
    'file:///data/user/0/cache/Camera/video.mp4'
  );
  assertEquals(
    normalizeVideoUri('file:///data/user/0/cache/Camera/video.mp4'),
    'file:///data/user/0/cache/Camera/video.mp4'
  );
  assertEquals(
    normalizeVideoUri('content://media/external/video/media/123'),
    'content://media/external/video/media/123'
  );
});

Deno.test('Item 5: decodifica %2540 e %252F do Expo Go para o caminho real do disco Android', () => {
  const expoGoUri = 'file:///data/user/0/host.exp.exponent/files/ExperienceData/%2540anonymous%252Fcontabot-123/capture.mp4';
  const candidates = prepareVideoUriCandidates(expoGoUri);
  assertEquals(
    candidates[0],
    'file:///data/user/0/host.exp.exponent/files/ExperienceData/%40anonymous%2Fcontabot-123/capture.mp4'
  );
});

Deno.test('Item 5: resolve vídeo existente diretamente', async () => {
  const fs = createMockFileSystem({
    'file:///data/user/0/cache/Camera/video.mp4': { exists: true, size: 500000 },
  });
  const resolved = await resolveAccessibleVideoUri('file:///data/user/0/cache/Camera/video.mp4', fs);
  assertEquals(resolved, 'file:///data/user/0/cache/Camera/video.mp4');
});

Deno.test('Item 5: copia para local permanente se caminho direto estiver em local temporário', async () => {
  const fs = createMockFileSystem({
    'raw_camera_stream.mp4': { exists: true, size: 250000 },
  });
  const resolved = await resolveAccessibleVideoUri('raw_camera_stream.mp4', fs);
  assertEquals(resolved, 'file:///data/user/0/host.exp.exponent/files/persistent_capture.mp4');
  const info = await fs.getInfoAsync(resolved);
  assert(info.exists);
  assertEquals(info.size, 250000);
});

Deno.test('Item 5: lança erro amigável se arquivo de vídeo foi limpo ou não existe', async () => {
  const fs = createMockFileSystem({});
  let errorMsg = '';
  try {
    await resolveAccessibleVideoUri('/data/user/0/cache/Camera/deleted.mp4', fs);
  } catch (err: any) {
    errorMsg = err.message;
  }
  assert(errorMsg.includes('O arquivo de vídeo não foi encontrado'));
});

Deno.test('Item 6: redirecionamento automático ocorre no sucesso da IA (done ou completed)', () => {
  // Sucesso real do banco (pipeline_finish grava status = 'done') e legado ('completed')
  assertEquals(
    shouldAutoRedirectToReview({ taskStatus: 'review', captureStatus: 'done' }),
    true
  );
  assertEquals(
    shouldAutoRedirectToReview({ taskStatus: 'review', captureStatus: 'completed' }),
    true
  );

  // Já submetido ou aprovado
  assertEquals(
    shouldAutoRedirectToReview({ taskStatus: 'submitted' }),
    true
  );
  assertEquals(
    shouldAutoRedirectToReview({ taskStatus: 'approved' }),
    true
  );
});

Deno.test('Item 6: NUNCA redireciona automaticamente quando captureStatus é failed', () => {
  // Mesmo que o backend tenha colocado taskStatus = 'review'
  assertEquals(
    shouldAutoRedirectToReview({ taskStatus: 'review', captureStatus: 'failed' }),
    false
  );
});

Deno.test('Item 6: NUNCA redireciona automaticamente quando localPhase é failed', () => {
  assertEquals(
    shouldAutoRedirectToReview({ taskStatus: 'review', localPhase: 'failed' }),
    false
  );
  assertEquals(
    shouldAutoRedirectToReview({ taskStatus: 'analyzing', localPhase: 'failed' }),
    false
  );
});

Deno.test('Item 6: NUNCA redireciona automaticamente quando envio foi interrompido', () => {
  assertEquals(
    shouldAutoRedirectToReview({ taskStatus: 'review', interrupted: true }),
    false
  );
  assertEquals(
    shouldAutoRedirectToReview({ taskStatus: 'analyzing', interrupted: true }),
    false
  );
});

Deno.test('Item 6: ao refilmar, falha antiga em cache é ignorada enquanto o novo envio local está ativo', () => {
  for (const phase of ['preparing', 'scoring', 'uploading'] as const) {
    const state = evaluateAnalyzingState({
      taskStatus: 'review',
      captureId: 'old-failed-capture',
      captureStatus: 'failed',
      localPhase: phase,
    });
    assertEquals(state.isFailed, false);
    assertEquals(state.shouldRedirect, false);
  }

  // Se o job local já tem um novo captureId mas o cache da query ainda traz o captureId antigo falhado
  const staleDuringAnalyzing = evaluateAnalyzingState({
    taskStatus: 'review',
    captureId: 'old-failed-capture',
    captureStatus: 'failed',
    localPhase: 'analyzing',
    localCaptureId: 'new-capture-id',
  });
  assertEquals(staleDuringAnalyzing.isFailed, false);
  assertEquals(staleDuringAnalyzing.shouldRedirect, false);

  // Quando o captureId do servidor é o mesmo e falha, aí sim reporta falha
  const realServerFail = evaluateAnalyzingState({
    taskStatus: 'review',
    captureId: 'new-capture-id',
    captureStatus: 'failed',
    localPhase: 'done',
    localCaptureId: 'new-capture-id',
  });
  assertEquals(realServerFail.isFailed, true);
  assertEquals(realServerFail.shouldRedirect, false);
});

Deno.test('Otimização de imagens: dimensões e qualidade de upload reduzidas para 1024px', () => {
  assertEquals(IMAGE_UPLOAD_SETTINGS.frameMaxDimension, 1024);
  assertEquals(IMAGE_UPLOAD_SETTINGS.frameQuality, 0.75);
  assertEquals(IMAGE_UPLOAD_SETTINGS.productPhotoMaxDimension, 1024);
  assertEquals(IMAGE_UPLOAD_SETTINGS.productPhotoQuality, 0.78);
});

Deno.test('Conferência: preenche quantidade conferida automaticamente com a sugestão da IA (ok, check ou 0)', () => {
  const counts = initialReviewCounts([
    { product_id: 'p-ok', ai_status: 'ok', ai_quantity: 5, counted: 5 },
    { product_id: 'p-check', ai_status: 'check', ai_quantity: 4, counted: null },
    { product_id: 'p-zero', ai_status: 'check', ai_quantity: 0, counted: null },
    { product_id: 'p-edited', ai_status: 'check', ai_quantity: 4, counted: 7 },
    { product_id: 'p-edited-zero', ai_status: 'ok', ai_quantity: 3, counted: 0 },
    { product_id: 'p-missing', ai_status: 'missing', ai_quantity: null, counted: null },
  ]);

  assertEquals(counts, {
    'p-ok': 5,
    'p-check': 4,
    'p-zero': 0,
    'p-edited': 7,
    'p-edited-zero': 0,
    'p-missing': null,
  });
});
