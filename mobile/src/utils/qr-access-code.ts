/**
 * Leitura e validação de códigos de acesso de funcionários a partir de QR Codes.
 *
 * O QRCodeModal gera `{"code":"ABCD-1234"}`, mas também aceitamos códigos
 * digitados/compartilhados em texto puro (com ou sem hífen).
 */

const ACCESS_CODE_BODY_RE = /^[A-Z0-9]{8}$/;

function normalizeAccessCode(raw: string): string | null {
  const cleaned = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!ACCESS_CODE_BODY_RE.test(cleaned)) {
    return null;
  }
  return `${cleaned.slice(0, 4)}-${cleaned.slice(4)}`;
}

/**
 * Extrai e normaliza o código de acesso no formato XXXX-XXXX a partir do texto
 * bruto lido pela câmera. Retorna `null` se o QR não for um convite válido.
 */
export function parseAccessCodeFromQr(rawData: string | null | undefined): string | null {
  if (!rawData) return null;
  const trimmed = rawData.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && 'code' in parsed) {
        const candidate = (parsed as { code?: unknown }).code;
        if (typeof candidate === 'string') {
          return normalizeAccessCode(candidate);
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  // Aceita somente códigos puros (sem URLs nem frases longas) para não aceitar QRs aleatórios.
  if (!/^[A-Za-z0-9\s-]{8,12}$/.test(trimmed)) {
    return null;
  }

  return normalizeAccessCode(trimmed);
}
