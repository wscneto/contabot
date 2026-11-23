import {
  formatIsoDateToBR,
  getRelativeIsoDate,
  maskBRDateInput,
  parseBRDateToIso,
} from '@/utils/date';

describe('utils/date', () => {
  describe('getRelativeIsoDate', () => {
    test('calcula hoje, amanhã e +7 dias em horário local sem pular dia', () => {
      // 23:30 local — um toISOString() em UTC-3 pularia para o dia seguinte
      const base = new Date(2026, 10, 23, 23, 30, 0);
      expect(getRelativeIsoDate(0, base)).toBe('2026-11-23');
      expect(getRelativeIsoDate(1, base)).toBe('2026-11-24');
      expect(getRelativeIsoDate(7, base)).toBe('2026-11-30');
    });

    test('vira o mês e o ano corretamente e usa data atual por padrão', () => {
      const dec31 = new Date(2026, 11, 31, 12, 0, 0);
      expect(getRelativeIsoDate(1, dec31)).toBe('2027-01-01');
      expect(getRelativeIsoDate(0)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe('formatIsoDateToBR', () => {
    test('converte AAAA-MM-DD válida para DD/MM/AAAA', () => {
      expect(formatIsoDateToBR('2026-11-23')).toBe('23/11/2026');
      expect(formatIsoDateToBR(' 2024-02-29 ')).toBe('29/02/2024');
    });

    test('retorna string vazia para nulo ou vazio', () => {
      expect(formatIsoDateToBR(null)).toBe('');
      expect(formatIsoDateToBR(undefined)).toBe('');
      expect(formatIsoDateToBR('')).toBe('');
    });

    test('preserva o texto original quando não é ISO válida', () => {
      expect(formatIsoDateToBR('23/11/2026')).toBe('23/11/2026');
      expect(formatIsoDateToBR('2026-02-30')).toBe('2026-02-30');
      expect(formatIsoDateToBR('1800-01-01')).toBe('1800-01-01');
    });
  });

  describe('parseBRDateToIso', () => {
    test('converte DD/MM/AAAA e AAAA-MM-DD válidas para ISO', () => {
      expect(parseBRDateToIso('23/11/2026')).toBe('2026-11-23');
      expect(parseBRDateToIso(' 29/02/2024 ')).toBe('2024-02-29');
      expect(parseBRDateToIso('2026-11-23')).toBe('2026-11-23');
    });

    test.each([
      [null],
      [undefined],
      [''],
      ['   '],
      ['31/02/2026'],
      ['29/02/2026'],
      ['2026-02-29'],
      ['32/01/2026'],
      ['10/13/2026'],
      ['01/01/1800'],
      ['23/11'],
      ['abc'],
    ])('rejeita entrada vazia ou inválida "%s"', (value) => {
      expect(parseBRDateToIso(value)).toBeNull();
    });
  });

  describe('maskBRDateInput', () => {
    test('aplica máscara progressiva DD/MM/AAAA ignorando não-dígitos', () => {
      expect(maskBRDateInput('')).toBe('');
      expect(maskBRDateInput('2')).toBe('2');
      expect(maskBRDateInput('23')).toBe('23');
      expect(maskBRDateInput('231')).toBe('23/1');
      expect(maskBRDateInput('2311')).toBe('23/11');
      expect(maskBRDateInput('23112026')).toBe('23/11/2026');
      expect(maskBRDateInput('23/11/2026999')).toBe('23/11/2026');
      expect(maskBRDateInput('ab23cd11ef2026')).toBe('23/11/2026');
    });
  });
});
