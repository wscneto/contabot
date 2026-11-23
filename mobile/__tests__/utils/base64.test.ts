import { base64ToBytes } from '@/utils/base64';
import { base64ToBytesReference as fromReference, bytesToBase64, utf8ToBase64 } from '../../test-utils/encoding';

describe('base64ToBytes', () => {
  test.each([
    ['', ''],
    ['f', 'Zg=='],
    ['fo', 'Zm8='],
    ['foo', 'Zm9v'],
    ['foob', 'Zm9vYg=='],
    ['ContaBot – ação', utf8ToBase64('ContaBot – ação')],
  ])('decodifica "%s" igual à implementação de referência (atob)', (_texto, b64) => {
    expect(base64ToBytes(b64)).toEqual(fromReference(b64));
  });

  test('decodifica todos os 256 valores de byte', () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    const b64 = bytesToBase64(all);
    expect(base64ToBytes(b64)).toEqual(all);
  });

  test('ignora quebras de linha e espaços (base64 MIME)', () => {
    const b64 = utf8ToBase64('cabeçalho JPEG de teste'.repeat(10));
    const wrapped = b64.replace(/(.{20})/g, '$1\r\n ');
    expect(base64ToBytes(wrapped)).toEqual(fromReference(b64));
  });

  test('aceita o prefixo de data URL só se removido antes (caracteres inválidos são descartados)', () => {
    // ":" ";" "," são descartados, mas as letras do prefixo viram bytes: quem chama precisa remover o prefixo.
    const b64 = 'Zm9v';
    expect(base64ToBytes(`data:image/jpeg;base64,${b64}`)).not.toEqual(fromReference(b64));
  });

  test('entrada grande (1 MB) é decodificada corretamente', () => {
    const big = new Uint8Array(1024 * 1024).map((_, i) => (i * 31) % 256);
    const b64 = bytesToBase64(big);
    expect(base64ToBytes(b64)).toEqual(big);
  });
});
