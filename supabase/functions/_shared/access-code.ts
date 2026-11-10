/**
 * Códigos de acesso de funcionário: 8 caracteres (exibidos como XXXX-XXXX).
 * Mesmo algoritmo de private.new_access_code / private.hash_access_code no SQL.
 */

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function normalizeAccessCode(code: string): string {
  return code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

export async function hashAccessCode(code: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalizeAccessCode(code)));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function generateAccessCode(): { raw: string; formatted: string } {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  // 256 é múltiplo de 32: o resto não enviesa nenhum caractere.
  const raw = [...bytes].map((b) => ALPHABET[b % 32]).join('');
  return { raw, formatted: `${raw.slice(0, 4)}-${raw.slice(4)}` };
}
