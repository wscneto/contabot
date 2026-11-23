import * as XLSX from 'xlsx';
import {
  buildApprovedTaskCsv,
  buildFilename,
  escapeCsvCell,
  type ApprovedTaskExport,
} from '@/utils/approved-task-csv';

const task = (items: ApprovedTaskExport['items']): ApprovedTaskExport => ({
  id: 't1',
  area_name: 'Corredor 1',
  approved_at: '2026-11-20T15:00:00Z',
  items,
});

/** Lê o CSV como uma planilha faria (sem converter números). */
const parse = (csv: string) =>
  XLSX.utils.sheet_to_json<string[]>(XLSX.read(csv, { type: 'string', raw: true }).Sheets.Sheet1, {
    header: 1,
    raw: false,
  });

describe('escapeCsvCell', () => {
  it('mantém texto simples e números', () => {
    expect(escapeCsvCell('Arroz')).toBe('Arroz');
    expect(escapeCsvCell(12)).toBe('12');
  });

  it('coloca entre aspas o que tem vírgula, aspas ou quebra de linha', () => {
    expect(escapeCsvCell('Café, 500 g')).toBe('"Café, 500 g"');
    expect(escapeCsvCell('Polegada 15"')).toBe('"Polegada 15"""');
    expect(escapeCsvCell('linha\nnova')).toBe('"linha\nnova"');
  });

  it.each(['=HYPERLINK("http://x","clique")', '+1+1', '-2+3', '@SUM(A1)', '\tcmd', '\rcmd'])(
    'neutraliza fórmula em %j',
    (value) => {
      const cell = escapeCsvCell(value);
      expect(cell.replace(/^"/, '').startsWith("'")).toBe(true);
    },
  );

  it('não altera números negativos (não são texto vindo do usuário)', () => {
    expect(escapeCsvCell(-1)).toBe('-1');
  });
});

describe('buildApprovedTaskCsv', () => {
  it('gera cabeçalho, BOM, CRLF e o nome com a variante', () => {
    const csv = buildApprovedTaskCsv(
      task([
        { barcode: '7891000999001', name: 'Chocolate', variant: '90 g', quantity: 3 },
        { barcode: '', name: 'Biscoito', variant: '', quantity: 0 },
      ]),
    );
    expect(csv).toBe(
      '﻿codigo_de_barras,nome,quantidade\r\n7891000999001,Chocolate (90 g),3\r\n,Biscoito,0\r\n',
    );
  });

  it('aceita variante nula e quantidade ausente', () => {
    const csv = buildApprovedTaskCsv(task([{ barcode: '1', name: 'Sal', variant: null, quantity: undefined as never }]));
    expect(csv.split('\r\n')[1]).toBe('1,Sal,0');
  });

  it('sem itens gera só o cabeçalho', () => {
    expect(buildApprovedTaskCsv(task([]))).toBe('﻿codigo_de_barras,nome,quantidade\r\n');
  });

  it('a planilha lê de volta exatamente os valores, com zeros à esquerda', () => {
    const items = [
      { barcode: '0012345678905', name: 'Café, "extra forte"', variant: '500 g', quantity: 7 },
      { barcode: '7891000999001', name: 'Linha\nquebrada', variant: '', quantity: 1000 },
      { barcode: '123', name: '=1+1', variant: '', quantity: 0 },
    ];
    const rows = parse(buildApprovedTaskCsv(task(items)).slice(1));
    expect(rows).toEqual([
      ['codigo_de_barras', 'nome', 'quantidade'],
      ['0012345678905', 'Café, "extra forte" (500 g)', '7'],
      ['7891000999001', 'Linha\nquebrada', '1000'],
      ['123', "'=1+1", '0'],
    ]);
  });
});

describe('buildFilename', () => {
  it('usa a área sem acentos e a data da aprovação', () => {
    expect(buildFilename('Depósito – Bebidas Geladas!', '2026-11-20T15:00:00Z')).toBe(
      'contagem-deposito-bebidas-geladas-2026-11-20.csv',
    );
  });

  it('usa "contagem" quando a área não tem letras nem dígitos', () => {
    expect(buildFilename('***', '2026-01-02T00:00:00Z')).toBe('contagem-contagem-2026-01-02.csv');
  });

  it('usa a data atual quando não há data de aprovação', () => {
    expect(buildFilename('A', null, new Date('2026-03-04T10:00:00Z'))).toBe('contagem-a-2026-03-04.csv');
  });

  it('limita o tamanho do nome do arquivo', () => {
    const name = buildFilename('x'.repeat(500), '2026-01-02');
    expect(name.length).toBeLessThanOrEqual('contagem--2026-01-02.csv'.length + 60);
    expect(name).not.toMatch(/--2026/);
  });
});
