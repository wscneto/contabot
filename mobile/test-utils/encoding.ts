/**
 * Conversões usadas só nos testes, sem depender de `Buffer` (tipos do Node não
 * fazem parte do tsconfig do app).
 */

export const utf8Bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function base64ToBytesReference(base64: string): Uint8Array {
  const binary = atob(base64);
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
}

export const utf8ToBase64 = (text: string): string => bytesToBase64(utf8Bytes(text));
