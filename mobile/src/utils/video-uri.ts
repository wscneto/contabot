/**
 * Normalização de URIs de vídeo (funções puras, usadas por services/capture.ts).
 */

/**
 * Garante o esquema `file:///` em caminhos locais. URIs `content://` e
 * `http(s)://` são devolvidas como vieram (sem espaços nas pontas).
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

/**
 * Variações do URI para tentar abrir o vídeo, em ordem de prioridade:
 * decodificado uma vez (se houver `%25`), normalizado e totalmente decodificado.
 * Sem duplicatas.
 */
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
