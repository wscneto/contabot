import { ImageManipulator, SaveFormat, type ImageRef } from 'expo-image-manipulator';

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_LOOKUP = new Uint8Array(256);
for (let i = 0; i < BASE64_ALPHABET.length; i++) BASE64_LOOKUP[BASE64_ALPHABET.charCodeAt(i)] = i;

/** Base64 → bytes sem depender de atob/Buffer (Hermes e web). */
export function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, '');
  const length = Math.floor((clean.length * 3) / 4);
  const bytes = new Uint8Array(length);
  let p = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = BASE64_LOOKUP[clean.charCodeAt(i)];
    const b = BASE64_LOOKUP[clean.charCodeAt(i + 1)];
    const c = BASE64_LOOKUP[clean.charCodeAt(i + 2)];
    const d = BASE64_LOOKUP[clean.charCodeAt(i + 3)];
    if (p < length) bytes[p++] = (a << 2) | (b >> 4);
    if (p < length) bytes[p++] = ((b & 15) << 4) | (c >> 2);
    if (p < length) bytes[p++] = ((c & 3) << 6) | d;
  }
  return bytes;
}

export interface EncodedImage {
  bytes: Uint8Array;
  width: number;
  height: number;
}

/** URI de arquivo ou referência nativa de imagem (ex.: VideoThumbnail do expo-video). */
export type ImageSource = Parameters<typeof ImageManipulator.manipulate>[0];

/**
 * Reduz (se preciso) para o lado maior <= maxDimension e codifica em JPEG.
 * Aceita URI de arquivo ou referência nativa (ex.: VideoThumbnail do expo-video).
 */
export async function encodeJpeg(
  source: ImageSource,
  maxDimension: number,
  quality = 0.9,
): Promise<EncodedImage> {
  let ref: ImageRef = await ImageManipulator.manipulate(source).renderAsync();
  const longest = Math.max(ref.width, ref.height);
  if (longest > maxDimension) {
    const scale = maxDimension / longest;
    const width = Math.max(1, Math.round(ref.width * scale));
    const height = Math.max(1, Math.round(ref.height * scale));
    ref.release();
    ref = await ImageManipulator.manipulate(source).resize({ width, height }).renderAsync();
  }
  try {
    const saved = await ref.saveAsync({ format: SaveFormat.JPEG, compress: quality, base64: true });
    if (!saved.base64) throw new Error('Falha ao codificar a imagem.');
    return { bytes: base64ToBytes(saved.base64), width: saved.width, height: saved.height };
  } finally {
    ref.release();
  }
}
