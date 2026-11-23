import {
  CHUNK_CHARS,
  createSecureSessionStorage,
  type LegacyStore,
  type SecureKeyValueStore,
  secureKey,
  splitChunks,
} from '@/lib/secure-session-storage';
import { utf8Bytes } from '../../test-utils/encoding';

/** SecureStore em memória que aplica as mesmas regras de chave do módulo nativo. */
function fakeSecureStore() {
  const data = new Map<string, string>();
  const store: SecureKeyValueStore = {
    getItemAsync: jest.fn(async (key: string) => {
      if (!/^[A-Za-z0-9._-]+$/.test(key)) throw new Error(`chave inválida: ${key}`);
      return data.get(key) ?? null;
    }),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      if (!/^[A-Za-z0-9._-]+$/.test(key)) throw new Error(`chave inválida: ${key}`);
      // Alguns iOS recusam valores acima de ~2 KB no Keychain.
      if (utf8Bytes(value).length > 2048) throw new Error('valor grande demais');
      data.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      data.delete(key);
    }),
  };
  return { store, data };
}

function fakeLegacy(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const legacy: LegacyStore = {
    getItem: (key) => data.get(key) ?? null,
    removeItem: (key) => void data.delete(key),
  };
  return { legacy, data };
}

/** Sessão realista: dois JWTs e metadados do usuário com acentos e emoji. */
const session = JSON.stringify({
  access_token: 'eyJ' + 'a'.repeat(1200),
  refresh_token: 'r'.repeat(40),
  user: { id: crypto.randomUUID(), user_metadata: { name: 'João Conceição 🧑‍🌾'.repeat(80) } },
});
const KEY = 'sb-127-auth-token';

describe('armazenamento seguro da sessão', () => {
  test('grava e lê de volta uma sessão maior que 2 KB, em pedaços aceitos pelo Keychain', async () => {
    const { store, data } = fakeSecureStore();
    const storage = createSecureSessionStorage(store);
    await storage.setItem(KEY, session);
    expect(await storage.getItem(KEY)).toBe(session);
    expect(data.size).toBeGreaterThan(3);
    for (const value of data.values()) expect(utf8Bytes(value).length).toBeLessThanOrEqual(2048);
    expect([...data.values()].some((v) => v.includes(session))).toBe(false);
  });

  test('sobrescrever com valor menor apaga os pedaços que sobraram', async () => {
    const { store, data } = fakeSecureStore();
    const storage = createSecureSessionStorage(store);
    await storage.setItem(KEY, session);
    await storage.setItem(KEY, '{"curta":true}');
    expect(await storage.getItem(KEY)).toBe('{"curta":true}');
    expect([...data.keys()].sort()).toEqual([`${KEY}.0`, `${KEY}.meta`]);
  });

  test('removeItem apaga tudo', async () => {
    const { store, data } = fakeSecureStore();
    const storage = createSecureSessionStorage(store);
    await storage.setItem(KEY, session);
    await storage.removeItem(KEY);
    expect(data.size).toBe(0);
    expect(await storage.getItem(KEY)).toBeNull();
  });

  test('leitura incompleta ou corrompida vira sessão ausente, nunca JSON quebrado', async () => {
    const { store, data } = fakeSecureStore();
    const storage = createSecureSessionStorage(store);
    await storage.setItem(KEY, session);
    data.delete(`${KEY}.1`);
    expect(await storage.getItem(KEY)).toBeNull();

    await storage.setItem(KEY, session);
    data.set(`${KEY}.0`, 'x'); // gravação interrompida
    expect(await storage.getItem(KEY)).toBeNull();

    for (const meta of ['lixo', '{"n":-1,"len":3}', '{"n":99999,"len":3}', '{"n":"2"}']) {
      data.set(`${KEY}.meta`, meta);
      expect(await storage.getItem(KEY)).toBeNull();
    }
  });

  test('migra a sessão antiga sem criptografia e apaga a cópia antiga', async () => {
    const { store } = fakeSecureStore();
    const { legacy, data: old } = fakeLegacy({ [KEY]: session });
    const storage = createSecureSessionStorage(store, legacy);
    expect(await storage.getItem(KEY)).toBe(session);
    expect(old.has(KEY)).toBe(false);
    // Segunda leitura já vem do SecureStore.
    expect(await createSecureSessionStorage(store).getItem(KEY)).toBe(session);
  });

  test('nada é gravado no armazenamento antigo', async () => {
    const { store } = fakeSecureStore();
    const { legacy, data: old } = fakeLegacy();
    const storage = createSecureSessionStorage(store, legacy);
    await storage.setItem(KEY, session);
    expect(old.size).toBe(0);
  });

  test('chaves com caracteres não aceitos pelo SecureStore são normalizadas', async () => {
    const { store } = fakeSecureStore();
    const storage = createSecureSessionStorage(store);
    await storage.setItem('sb-192.168.0.10:54321-auth-token', 'ok');
    expect(await storage.getItem('sb-192.168.0.10:54321-auth-token')).toBe('ok');
    expect(secureKey('a b/c:d@e')).toBe('a_b_c_d_e');
  });

  test('a divisão em pedaços nunca separa um emoji (par substituto)', () => {
    const text = 'a'.repeat(CHUNK_CHARS - 1) + '🧀' + 'b'.repeat(10);
    const chunks = splitChunks(text);
    expect(chunks.join('')).toBe(text);
    for (const chunk of chunks) {
      const last = chunk.charCodeAt(chunk.length - 1);
      expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
    }
    expect(splitChunks('')).toEqual([]);
  });

  test('valor vazio é gravado e lido como texto vazio', async () => {
    const { store } = fakeSecureStore();
    const storage = createSecureSessionStorage(store);
    await storage.setItem(KEY, '');
    expect(await storage.getItem(KEY)).toBe('');
  });
});
