import { ImageManipulator, SaveFormat, type ImageRef } from 'expo-image-manipulator';
import { base64ToBytes } from '../utils/base64';

export { base64ToBytes };

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
