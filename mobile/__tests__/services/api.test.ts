import { FunctionsHttpError } from '@supabase/supabase-js';
import { api } from '@/services/api';

const mockRpc = jest.fn();
const mockInvoke = jest.fn();
const mockCreateSignedUrls = jest.fn();
const mockUpload = jest.fn();

jest.mock('../../src/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
    storage: {
      from: () => ({
        createSignedUrls: (...args: unknown[]) => mockCreateSignedUrls(...args),
        upload: (...args: unknown[]) => mockUpload(...args),
      }),
    },
  },
}));

jest.mock('../../src/services/images', () => ({
  encodeJpeg: jest.fn(async () => ({ bytes: new Uint8Array([0xff, 0xd8]), width: 10, height: 10 })),
}));

const STORE = '11111111-2222-3333-4444-555555555555';

describe('services/api', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockCreateSignedUrls.mockResolvedValue({ data: [], error: null });
  });
  afterEach(() => jest.restoreAllMocks());

  describe('rpc: tratamento de erros', () => {
    test('erro de rede vira mensagem amigável', async () => {
      mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'TypeError: Network request failed' } });
      await expect(api.listProducts()).rejects.toThrow('Não foi possível conectar ao servidor. Verifique sua conexão.');
    });

    test('erro do banco repassa a mensagem', async () => {
      mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'Produto não encontrado' } });
      await expect(api.getProduct('x')).rejects.toThrow('Produto não encontrado');
    });

    test('erro sem mensagem usa texto padrão', async () => {
      mockRpc.mockResolvedValueOnce({ data: null, error: {} });
      await expect(api.listAreas()).rejects.toThrow('Ocorreu um erro ao processar sua requisição.');
    });

    test('envia os parâmetros esperados à RPC', async () => {
      mockRpc.mockResolvedValueOnce({ data: { count: 2, products: [] }, error: null });
      const items = [{ name: 'Arroz' }, { name: 'Feijão', min_stock: 3 }];
      await expect(api.importProducts(items)).resolves.toEqual({ count: 2, products: [] });
      expect(mockRpc).toHaveBeenCalledWith('import_products', { p_items: items });
    });
  });

  describe('URLs assinadas de mídia', () => {
    test('troca caminhos do bucket por URLs assinadas e preserva o resto', async () => {
      const photo = `${STORE}/products/abc.jpg`;
      const frame = `${STORE}/captures/c1/f1.jpg`;
      mockRpc.mockResolvedValueOnce({
        data: {
          products: [{ name: `${STORE}/outra/pasta.jpg`, photos: [photo, photo], cover: photo }],
          frame,
          note: 'texto qualquer',
          count: 3,
          empty: null,
        },
        error: null,
      });
      mockCreateSignedUrls.mockResolvedValueOnce({
        data: [
          { path: photo, signedUrl: 'https://cdn/signed-photo' },
          { path: frame, signedUrl: 'https://cdn/signed-frame' },
        ],
        error: null,
      });

      const result = await api.listProducts();

      expect(result).toEqual({
        products: [
          {
            name: `${STORE}/outra/pasta.jpg`, // pasta fora de products/captures não é assinada
            photos: ['https://cdn/signed-photo', 'https://cdn/signed-photo'],
            cover: 'https://cdn/signed-photo',
          },
        ],
        frame: 'https://cdn/signed-frame',
        note: 'texto qualquer',
        count: 3,
        empty: null,
      });
      // Caminhos repetidos são assinados uma única vez, em lote
      expect(mockCreateSignedUrls).toHaveBeenCalledTimes(1);
      expect(mockCreateSignedUrls.mock.calls[0][0].sort()).toEqual([frame, photo].sort());
    });

    test('usa o cache em chamadas seguintes', async () => {
      const photo = `${STORE}/products/cache-test.jpg`;
      mockCreateSignedUrls.mockResolvedValueOnce({
        data: [{ path: photo, signedUrl: 'https://cdn/cached' }],
        error: null,
      });
      mockRpc.mockResolvedValue({ data: { photo }, error: null });

      await expect(api.getProduct('1')).resolves.toEqual({ photo: 'https://cdn/cached' });
      await expect(api.getProduct('1')).resolves.toEqual({ photo: 'https://cdn/cached' });
      expect(mockCreateSignedUrls).toHaveBeenCalledTimes(1);
    });

    test('falha ao assinar mantém o caminho original em vez de quebrar a tela', async () => {
      const photo = `${STORE}/products/sem-url.jpg`;
      mockRpc.mockResolvedValueOnce({ data: [photo], error: null });
      mockCreateSignedUrls.mockResolvedValueOnce({ data: null, error: { message: 'storage fora do ar' } });
      await expect(api.listProducts()).resolves.toEqual([photo]);
    });

    test('chaves "__proto__" na resposta não poluem Object.prototype', async () => {
      const malicious = JSON.parse('{"__proto__": {"polluted": true}, "ok": 1}');
      mockRpc.mockResolvedValueOnce({ data: malicious, error: null });
      await api.listProducts();
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });

    test('whoami não passa pela assinatura de mídia', async () => {
      mockRpc.mockResolvedValueOnce({ data: { avatar: `${STORE}/products/a.jpg` }, error: null });
      await expect(api.whoami()).resolves.toEqual({ avatar: `${STORE}/products/a.jpg` });
      expect(mockCreateSignedUrls).not.toHaveBeenCalled();
    });
  });

  describe('Edge Functions', () => {
    test('erro HTTP repassa o "detail" do corpo', async () => {
      const error = new FunctionsHttpError({ json: async () => ({ detail: 'Código inválido ou expirado.' }) });
      mockInvoke.mockResolvedValueOnce({ data: null, error });
      await expect(api.joinWithCode('ZZZ')).rejects.toThrow('Código inválido ou expirado.');
    });

    test('erro HTTP com corpo ilegível usa mensagem padrão', async () => {
      const error = new FunctionsHttpError({ json: async () => Promise.reject(new Error('not json')) });
      mockInvoke.mockResolvedValueOnce({ data: null, error });
      await expect(api.createEmployee('Ana')).rejects.toThrow('Ocorreu um erro ao processar sua requisição.');
    });

    test('erro de rede vira mensagem de conexão', async () => {
      mockInvoke.mockResolvedValueOnce({ data: null, error: new Error('fetch failed') });
      await expect(api.analyzeCapture('c1')).rejects.toThrow('Não foi possível conectar ao servidor.');
    });
  });

  describe('produtos com fotos', () => {
    test.each([[0], [5]])('createProduct rejeita %i fotos sem chamar o servidor', async (n) => {
      const photoUris = Array.from({ length: n }, (_, i) => `file:///foto${i}.jpg`);
      await expect(api.createProduct(STORE, { name: 'X', photoUris })).rejects.toThrow('Envie de 1 a 4 fotos do produto.');
      expect(mockUpload).not.toHaveBeenCalled();
      expect(mockRpc).not.toHaveBeenCalled();
    });

    test('envia as fotos para a pasta da loja com nomes aleatórios e sem sobrescrever', async () => {
      mockUpload.mockResolvedValue({ error: null });
      mockRpc.mockResolvedValueOnce({ data: { id: 'p1' }, error: null });

      await api.createProduct(STORE, { name: 'Café', barcode: '789', photoUris: ['a.jpg', 'b.jpg'] });

      expect(mockUpload).toHaveBeenCalledTimes(2);
      const paths = mockUpload.mock.calls.map((c) => c[0] as string);
      for (const path of paths) {
        expect(path).toMatch(new RegExp(`^${STORE}/products/[0-9a-f]{32}\\.jpg$`));
      }
      expect(new Set(paths).size).toBe(2);
      expect(mockUpload.mock.calls[0][2]).toEqual({ contentType: 'image/jpeg', upsert: false });
      expect(mockRpc).toHaveBeenCalledWith('create_product', {
        p_name: 'Café',
        p_variant: '',
        p_barcode: '789',
        p_min_stock: null,
        p_photos: paths,
      });
    });

    test('falha no upload interrompe o cadastro', async () => {
      mockUpload.mockResolvedValueOnce({ error: { message: 'quota excedida' } });
      await expect(api.createProduct(STORE, { name: 'X', photoUris: ['a.jpg'] })).rejects.toThrow(
        'Falha ao enviar imagem: quota excedida',
      );
      expect(mockRpc).not.toHaveBeenCalled();
    });
  });
});
