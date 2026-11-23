import { parseAccessCodeFromQr } from '@/utils/qr-access-code';

describe('utils/qr-access-code', () => {
  test('lê o payload JSON gerado pelo QRCodeModal', () => {
    expect(parseAccessCodeFromQr(JSON.stringify({ code: 'ANA1-2345' }))).toBe('ANA1-2345');
    expect(parseAccessCodeFromQr(' {"code": " ana12345 "} ')).toBe('ANA1-2345');
  });

  test('aceita código puro em texto com ou sem hífen e em minúsculas', () => {
    expect(parseAccessCodeFromQr('ANA1-2345')).toBe('ANA1-2345');
    expect(parseAccessCodeFromQr('ana12345')).toBe('ANA1-2345');
    expect(parseAccessCodeFromQr('  ana1 2345 ')).toBe('ANA1-2345');
  });

  test.each([
    [null],
    [undefined],
    [''],
    ['   '],
    ['{}'],
    ['{"code": 12345678}'],
    ['{"code": "CURTO"}'],
    ['{json-quebrado'],
    ['https://contabot.app/convite/ANA1-2345'],
    ['CODIGO-LONGO-DEMAIS-1234'],
    ['ABC-123'],
    ['123456789'],
  ])('rejeita payload inválido "%s"', (raw) => {
    expect(parseAccessCodeFromQr(raw)).toBeNull();
  });
});
