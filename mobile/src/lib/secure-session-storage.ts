/**
 * Armazenamento da sessão do Supabase no SecureStore (Keychain no iOS,
 * SharedPreferences cifradas pelo Android Keystore), em vez do localStorage do
 * expo-sqlite, que grava o access token e o refresh token sem criptografia.
 *
 * Uma sessão passa de 2 KB e alguns iOS recusam valores maiores que isso no
 * Keychain; por isso o valor é dividido em pedaços de até ~1,8 KB em UTF-8.
 * Uma chave "<chave>.meta" guarda quantos pedaços existem e o tamanho total, o
 * que permite descartar leituras incompletas (ex.: app fechado no meio de uma
 * gravação) em vez de entregar JSON corrompido.
 *
 * Funções puras sobre uma interface mínima, para serem testadas sem módulo nativo.
 */

export interface SecureKeyValueStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

/** Armazenamento antigo (sem criptografia), lido só para migrar a sessão. */
export interface LegacyStore {
  getItem(key: string): string | null;
  removeItem(key: string): void;
}

/** Caracteres por pedaço: até 3 bytes cada em UTF-8 → no máximo 1.800 bytes. */
export const CHUNK_CHARS = 600;
const MAX_CHUNKS = 200;

/** O SecureStore só aceita letras, dígitos, ".", "-" e "_" nas chaves. */
export const secureKey = (key: string): string => key.replace(/[^A-Za-z0-9._-]/g, '_');

/** Divide o texto sem separar pares substitutos (emoji e afins). */
export function splitChunks(value: string, size = CHUNK_CHARS): string[] {
  const chunks: string[] = [];
  for (let start = 0; start < value.length; ) {
    let end = Math.min(start + size, value.length);
    const last = value.charCodeAt(end - 1);
    if (end < value.length && last >= 0xd800 && last <= 0xdbff) end -= 1;
    chunks.push(value.slice(start, end));
    start = end;
  }
  return chunks;
}

interface Meta {
  n: number;
  len: number;
}

function parseMeta(raw: string | null): Meta | null {
  if (!raw) return null;
  try {
    const meta = JSON.parse(raw) as Meta;
    if (!Number.isInteger(meta.n) || meta.n < 0 || meta.n > MAX_CHUNKS || !Number.isInteger(meta.len)) return null;
    return meta;
  } catch {
    return null;
  }
}

export function createSecureSessionStorage(store: SecureKeyValueStore, legacy?: LegacyStore | null) {
  const metaKey = (k: string) => `${k}.meta`;
  const chunkKey = (k: string, i: number) => `${k}.${i}`;

  async function deleteChunks(k: string, from: number, to: number) {
    await Promise.all(Array.from({ length: Math.max(0, to - from) }, (_, i) => store.deleteItemAsync(chunkKey(k, from + i))));
  }

  async function read(key: string): Promise<string | null> {
    const k = secureKey(key);
    const meta = parseMeta(await store.getItemAsync(metaKey(k)));
    if (!meta) return null;
    const parts = await Promise.all(Array.from({ length: meta.n }, (_, i) => store.getItemAsync(chunkKey(k, i))));
    if (parts.some((p) => p === null)) return null;
    const value = parts.join('');
    return value.length === meta.len ? value : null;
  }

  async function setItem(key: string, value: string): Promise<void> {
    const k = secureKey(key);
    const previous = parseMeta(await store.getItemAsync(metaKey(k)));
    const chunks = splitChunks(value);
    if (chunks.length > MAX_CHUNKS) throw new Error('Valor grande demais para o armazenamento seguro.');
    // Pedaços primeiro, metadados por último: uma gravação interrompida não
    // passa na verificação de tamanho e a sessão é tratada como ausente.
    await Promise.all(chunks.map((chunk, i) => store.setItemAsync(chunkKey(k, i), chunk)));
    await store.setItemAsync(metaKey(k), JSON.stringify({ n: chunks.length, len: value.length }));
    if (previous && previous.n > chunks.length) await deleteChunks(k, chunks.length, previous.n);
    legacy?.removeItem(key);
  }

  async function removeItem(key: string): Promise<void> {
    const k = secureKey(key);
    const meta = parseMeta(await store.getItemAsync(metaKey(k)));
    await store.deleteItemAsync(metaKey(k));
    if (meta) await deleteChunks(k, 0, meta.n);
    legacy?.removeItem(key);
  }

  async function getItem(key: string): Promise<string | null> {
    const value = await read(key);
    if (value !== null || !legacy) return value;
    // Migra a sessão gravada sem criptografia por versões anteriores do app.
    const old = legacy.getItem(key);
    if (old === null) return null;
    await setItem(key, old);
    return old;
  }

  return { getItem, setItem, removeItem };
}
