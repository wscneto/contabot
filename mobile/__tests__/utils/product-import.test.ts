import * as XLSX from 'xlsx';
import {
  decodeText,
  decodeUtf8,
  decodeWindows1252,
  getFirstNonEmptySheetRows,
  NO_SHEETS_ERROR,
  NO_VALID_PRODUCTS_ERROR,
  parseMinStock,
  parseProductWorkbook,
  parseSheetRows,
  readProductFile,
} from '@/utils/product-import';
import { utf8Bytes, utf8ToBase64 } from '../../test-utils/encoding';

/** Monta uma pasta de trabalho em memória a partir de linhas (array de arrays). */
function buildWorkbook(sheets: Record<string, unknown[][]>): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return wb;
}

/** Simula o caminho nativo da tela: arquivo → base64 → XLSX.read. */
function roundTripXlsx(wb: XLSX.WorkBook): XLSX.WorkBook {
  const base64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
  return XLSX.read(base64, { type: 'base64' });
}

/** Simula o caminho web da tela: ArrayBuffer → Uint8Array → XLSX.read. */
function readCsvAsArray(csv: string, withBom = false): XLSX.WorkBook {
  return XLSX.read(utf8Bytes((withBom ? '\uFEFF' : '') + csv), { type: 'array' });
}

const POLLUTION_KEYS = ['polluted', 'isAdmin', 'name', 'variant', 'barcode', 'min_stock', 'toString'];

/** Garante que nada novo apareceu em Object.prototype (prototype pollution). */
function expectPrototypeClean() {
  const probe: Record<string, unknown> = {};
  expect(probe.polluted).toBeUndefined();
  expect(probe.isAdmin).toBeUndefined();
  expect(Object.keys(Object.prototype)).toEqual([]);
  for (const key of POLLUTION_KEYS) {
    if (key === 'toString') {
      expect(probe.toString).toBe(Object.prototype.toString);
    } else {
      expect(key in probe).toBe(false);
    }
  }
}

describe('parseSheetRows', () => {
  describe('detecção do cabeçalho', () => {
    test('usa a linha 0 quando ela já é o cabeçalho', () => {
      const items = parseSheetRows([
        ['Nome', 'Variante', 'Código de Barras', 'Estoque Mínimo'],
        ['Arroz Tio João', '1kg', '7891234567890', '10'],
      ]);
      expect(items).toEqual([
        { name: 'Arroz Tio João', variant: '1kg', barcode: '7891234567890', min_stock: 10 },
      ]);
    });

    test('encontra o cabeçalho abaixo de linhas de título (até a 5ª linha)', () => {
      const items = parseSheetRows([
        ['Relatório de estoque - Loja Centro'],
        [],
        ['Gerado em 01/11/2026'],
        ['Cód. SAP', 'Descrição', 'EAN'],
        ['123', 'Feijão Carioca', '7890000000001'],
      ]);
      expect(items).toEqual([
        { name: 'Feijão Carioca', variant: '', barcode: '7890000000001', min_stock: null },
      ]);
    });

    test('ignora palavras-chave depois da 5ª linha e trata tudo como dados da 1ª coluna', () => {
      const items = parseSheetRows([
        ['a'],
        ['b'],
        ['c'],
        ['d'],
        ['e'],
        ['Nome'],
        ['Arroz'],
      ]);
      // Sem cabeçalho reconhecido: coluna 0 desde a linha 0; o rótulo "Nome" é descartado.
      expect(items.map((i) => i.name)).toEqual(['a', 'b', 'c', 'd', 'e', 'Arroz']);
    });

    test('sem cabeçalho nenhum, importa a primeira coluna de todas as linhas', () => {
      const items = parseSheetRows([['Arroz'], ['Feijão'], ['Macarrão']]);
      expect(items.map((i) => i.name)).toEqual(['Arroz', 'Feijão', 'Macarrão']);
      expect(items.every((i) => i.min_stock === null && i.barcode === '' && i.variant === '')).toBe(true);
    });

    test('cabeçalho só com código de barras: nome cai na coluna 0 e linha 0 vira dado', () => {
      // "EAN" marca a linha como cabeçalho, mas não há coluna de nome; o parser
      // então usa a coluna 0 a partir da linha 0 (inclusive o próprio cabeçalho).
      const items = parseSheetRows([
        ['EAN', 'Qtd'],
        ['789', '3'],
      ]);
      expect(items).toEqual([
        { name: 'EAN', variant: '', barcode: 'EAN', min_stock: null },
        { name: '789', variant: '', barcode: '789', min_stock: null },
      ]);
    });
  });

  describe('mapeamento de colunas', () => {
    test.each([
      ['Nome'],
      ['NOME DO PRODUTO'],
      ['Descrição'],
      ['descricao'],
      ['Descrição do item'],
      ['Produto'],
      ['Product'],
      ['Item'],
    ])('reconhece "%s" como coluna de nome', (header) => {
      const items = parseSheetRows([
        ['Outra', header],
        ['x', 'Café Pilão 500g'],
      ]);
      expect(items).toHaveLength(1);
      expect(items[0].name).toBe('Café Pilão 500g');
    });

    test('prioriza "Descrição"/"Nome" sobre "Produto"', () => {
      const items = parseSheetRows([
        ['Produto', 'Descrição'],
        ['categoria', 'Leite Integral'],
      ]);
      expect(items[0].name).toBe('Leite Integral');
    });

    test('não confunde "Código do produto" / "Cód. Descrição" com a coluna de nome', () => {
      const items = parseSheetRows([
        ['Código do Produto', 'Cód. Descrição', 'Produto'],
        ['001', 'X1', 'Açúcar Refinado'],
      ]);
      expect(items[0].name).toBe('Açúcar Refinado');
    });

    test.each([['Código de Barras'], ['EAN'], ['EAN-13'], ['GTIN'], ['barcode'], ['Cod. Barra']])(
      'reconhece "%s" como código de barras',
      (header) => {
        const items = parseSheetRows([
          ['Nome', header],
          ['Óleo de Soja', '7891107101621'],
        ]);
        expect(items[0].barcode).toBe('7891107101621');
      },
    );

    test.each([['Variante'], ['Variant'], ['Gramatura'], ['Peso'], ['Apresentação']])(
      'reconhece "%s" como variante',
      (header) => {
        const items = parseSheetRows([
          ['Nome', header],
          ['Sabão em pó', '800g'],
        ]);
        expect(items[0].variant).toBe('800g');
      },
    );

    test.each([['Estoque Mínimo'], ['Mínimo'], ['minimo'], ['min_stock'], ['estoque_min']])(
      'reconhece "%s" como estoque mínimo',
      (header) => {
        const items = parseSheetRows([
          ['Nome', header],
          ['Detergente', '12'],
        ]);
        expect(items[0].min_stock).toBe(12);
      },
    );

    test('usa a primeira coluna que casa quando há duplicadas', () => {
      const items = parseSheetRows([
        ['Nome', 'EAN', 'Nome', 'EAN'],
        ['Primeiro', '111', 'Segundo', '222'],
      ]);
      expect(items[0]).toMatchObject({ name: 'Primeiro', barcode: '111' });
    });

    test('remove espaços nas pontas e converte números em texto', () => {
      const items = parseSheetRows([
        ['Nome', 'Variante', 'EAN'],
        ['  Biscoito  ', ' 200 g ', 7891000100103],
      ]);
      expect(items[0]).toEqual({
        name: 'Biscoito',
        variant: '200 g',
        barcode: '7891000100103',
        min_stock: null,
      });
    });
  });

  describe('linhas ignoradas', () => {
    test('pula linhas vazias, nulas e com nome em branco', () => {
      const rows = [
        ['Nome', 'EAN'],
        [],
        ['', '123'],
        ['   ', '456'],
        [undefined, '789'],
        ['Arroz', '111'],
      ] as unknown[][];
      // Linha "buraco" (sparse) como o sheet_to_json produz para linhas vazias
      rows.splice(2, 0, undefined as unknown as unknown[]);
      const items = parseSheetRows(rows);
      expect(items).toEqual([{ name: 'Arroz', variant: '', barcode: '111', min_stock: null }]);
    });

    test('pula rótulos de cabeçalho repetidos no meio da planilha', () => {
      const items = parseSheetRows([
        ['Descrição'],
        ['Arroz'],
        ['Descrição'],
        ['DESCRICAO'],
        ['nome'],
        ['Produto'],
        ['Feijão'],
      ]);
      expect(items.map((i) => i.name)).toEqual(['Arroz', 'Feijão']);
    });

    test('mantém o nome 0 numérico; célula "buraco" (como o sheet_to_json gera) é ignorada', () => {
      const items = parseSheetRows([['Nome', 'EAN'], [0], [, '789']]);
      expect(items.map((i) => i.name)).toEqual(['0']);
    });
  });

  describe('estoque mínimo', () => {
    const minStockOf = (cell: unknown) =>
      parseSheetRows([
        ['Nome', 'Estoque Mínimo'],
        ['Produto X', cell],
      ])[0].min_stock;

    test('inteiros (número ou texto) são aceitos', () => {
      expect(minStockOf(5)).toBe(5);
      expect(minStockOf('20')).toBe(20);
      expect(minStockOf(0)).toBe(0);
    });

    test('texto com unidade mantém só os dígitos', () => {
      expect(minStockOf('10 unidades')).toBe(10);
      expect(minStockOf('cx 3')).toBe(3);
    });

    test('valores não numéricos, vazios ou ausentes viram null', () => {
      expect(minStockOf('abc')).toBeNull();
      expect(minStockOf('')).toBeNull();
      expect(minStockOf(undefined)).toBeNull();
      expect(minStockOf(null)).toBeNull(); // String(null) = "null" → sem dígitos
    });

    test('negativos e frações são recusados em vez de virarem outro número', () => {
      expect(minStockOf('-5')).toBeNull();
      expect(minStockOf(-5)).toBeNull();
      expect(minStockOf(2.5)).toBeNull();
      expect(minStockOf('2,5')).toBeNull();
      expect(minStockOf('2.5')).toBeNull();
    });

    test('convenção brasileira: ponto de milhar e vírgula decimal', () => {
      expect(minStockOf('1.000')).toBe(1000);
      expect(minStockOf('12.500')).toBe(12500);
      expect(minStockOf('5,0')).toBe(5);
      expect(minStockOf('5,00 un')).toBe(5);
    });

    test('limite de 1.000.000 (mesmo do servidor) e números gigantes', () => {
      expect(minStockOf(1_000_000)).toBe(1_000_000);
      expect(minStockOf(1_000_001)).toBeNull();
      expect(minStockOf('9'.repeat(400))).toBeNull();
      expect(minStockOf(Infinity)).toBeNull();
      expect(minStockOf(Number.NaN)).toBeNull();
    });

    test('texto com mais de um número é ambíguo e vira null', () => {
      expect(minStockOf('cx 12 un 3')).toBeNull();
      expect(minStockOf('10-20')).toBeNull();
    });

    test('sem coluna de estoque mínimo, min_stock é null', () => {
      expect(parseSheetRows([['Nome'], ['X']])[0].min_stock).toBeNull();
    });

    test('parseMinStock isolado', () => {
      expect(parseMinStock(undefined)).toBeNull();
      expect(parseMinStock('42')).toBe(42);
      expect(parseMinStock('nenhum')).toBeNull();
    });
  });

  describe('entradas vazias e hostis', () => {
    test('lista vazia ou nula não gera itens', () => {
      expect(parseSheetRows([])).toEqual([]);
      expect(parseSheetRows(null as unknown as unknown[][])).toEqual([]);
      expect(parseSheetRows(undefined as unknown as unknown[][])).toEqual([]);
    });

    test('planilha só com cabeçalho não gera itens', () => {
      expect(parseSheetRows([['Nome', 'EAN', 'Estoque Mínimo']])).toEqual([]);
    });

    test('células "__proto__" / "constructor" são tratadas como texto e não poluem protótipos', () => {
      const items = parseSheetRows([
        ['__proto__', 'Nome', 'constructor', 'EAN'],
        ['{"polluted":true}', '__proto__', 'prototype', 'constructor'],
        ['x', 'constructor', 'y', '__proto__'],
      ]);
      expect(items).toEqual([
        { name: '__proto__', variant: '', barcode: 'constructor', min_stock: null },
        { name: 'constructor', variant: '', barcode: '__proto__', min_stock: null },
      ]);
      // Cada item é um objeto comum, com protótipo padrão
      for (const item of items) {
        expect(Object.getPrototypeOf(item)).toBe(Object.prototype);
        expect(Object.keys(item).sort()).toEqual(['barcode', 'min_stock', 'name', 'variant']);
      }
      expectPrototypeClean();
    });

    test('objetos estranhos nas células são convertidos com String() sem quebrar', () => {
      const evil = { toString: () => 'Produto Malicioso' };
      const items = parseSheetRows([['Nome'], [evil], [['a', 'b']], [Symbol.iterator.description]]);
      expect(items.map((i) => i.name)).toEqual(['Produto Malicioso', 'a,b', 'Symbol.iterator']);
    });

    test('strings muito longas são preservadas e processadas rapidamente (sem ReDoS)', () => {
      const longName = 'A'.repeat(100_000);
      const longHeader = 'x'.repeat(50_000) + ' código ' + 'ã'.repeat(50_000);
      const start = Date.now();
      const items = parseSheetRows([
        [longHeader, 'Nome', 'Estoque Mínimo'],
        ['ignorado', longName, '9'.repeat(400)],
      ]);
      expect(Date.now() - start).toBeLessThan(1000);
      expect(items).toHaveLength(1);
      expect(items[0].name).toHaveLength(100_000);
      // Acima do teto de 1.000.000 o estoque mínimo é descartado (antes virava Infinity).
      expect(items[0].min_stock).toBeNull();
    });

    test('muitas linhas são processadas em tempo razoável', () => {
      const rows: unknown[][] = [['Nome', 'EAN', 'Estoque Mínimo']];
      for (let i = 0; i < 20_000; i++) rows.push([`Produto ${i}`, `789${i}`, String(i % 50)]);
      const start = Date.now();
      const items = parseSheetRows(rows);
      expect(Date.now() - start).toBeLessThan(2000);
      expect(items).toHaveLength(20_000);
      expect(items[19_999]).toEqual({
        name: 'Produto 19999',
        variant: '',
        barcode: '78919999',
        min_stock: 49,
      });
    });
  });
});

describe('parseProductWorkbook (arquivos reais)', () => {
  test('lê um XLSX gerado com XLSX.write (caminho nativo, base64)', () => {
    const wb = roundTripXlsx(
      buildWorkbook({
        Produtos: [
          ['Estoque - Loja 1'],
          ['Descrição', 'Gramatura', 'Código de Barras', 'Estoque Mínimo'],
          ['Arroz Branco', '5kg', 7896006716112, 4],
          ['', '1kg', 123, 1],
          ['Feijão Preto', '1kg', '7896006744115', 'seis'],
        ],
      }),
    );
    expect(parseProductWorkbook(wb)).toEqual([
      { name: 'Arroz Branco', variant: '5kg', barcode: '7896006716112', min_stock: 4 },
      { name: 'Feijão Preto', variant: '1kg', barcode: '7896006744115', min_stock: null },
    ]);
  });

  test('lê um XLSX como ArrayBuffer (caminho web)', () => {
    const wb = buildWorkbook({ P: [['Nome'], ['Sabonete']] });
    const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const read = XLSX.read(new Uint8Array(buffer), { type: 'array' });
    expect(parseProductWorkbook(read)).toEqual([
      { name: 'Sabonete', variant: '', barcode: '', min_stock: null },
    ]);
  });

  test('usa a próxima aba quando a primeira está vazia', () => {
    const wb = roundTripXlsx(
      buildWorkbook({
        Capa: [],
        Dados: [['Produto'], ['Água Mineral 500ml']],
      }),
    );
    expect(getFirstNonEmptySheetRows(wb)).toEqual([['Produto'], ['Água Mineral 500ml']]);
    expect(parseProductWorkbook(wb).map((i) => i.name)).toEqual(['Água Mineral 500ml']);
  });

  test('não procura em outras abas se a primeira tem linhas (mesmo sem produtos)', () => {
    const wb = buildWorkbook({
      Capa: [['Nome']],
      Dados: [['Nome'], ['Ignorado']],
    });
    expect(() => parseProductWorkbook(wb)).toThrow(NO_VALID_PRODUCTS_ERROR);
  });

  test('lê CSV UTF-8 com BOM (formato "CSV UTF-8" do Excel)', () => {
    const csv = 'Descrição,Código de Barras,Estoque Mínimo\nFeijão Carioca,7891234567890,10\nAçúcar,,\n';
    const wb = readCsvAsArray(csv, true);
    expect(parseProductWorkbook(wb)).toEqual([
      { name: 'Feijão Carioca', variant: '', barcode: '7891234567890', min_stock: 10 },
      { name: 'Açúcar', variant: '', barcode: '', min_stock: null },
    ]);
  });

  test('lê CSV com ponto e vírgula via base64 (caminho nativo)', () => {
    const csv = 'Nome;EAN;Minimo\nArroz;789100;3\nMacarrao;789200;0\n';
    const wb = XLSX.read(utf8ToBase64(csv), { type: 'base64' });
    expect(parseProductWorkbook(wb)).toEqual([
      { name: 'Arroz', variant: '', barcode: '789100', min_stock: 3 },
      { name: 'Macarrao', variant: '', barcode: '789200', min_stock: 0 },
    ]);
  });

  test('pasta sem abas lança erro amigável', () => {
    expect(() => parseProductWorkbook({ SheetNames: [], Sheets: {} })).toThrow(NO_SHEETS_ERROR);
    expect(() =>
      parseProductWorkbook({ Sheets: {} } as unknown as XLSX.WorkBook),
    ).toThrow(NO_SHEETS_ERROR);
  });

  test('planilha vazia lança erro de "nenhum produto válido"', () => {
    const wb = roundTripXlsx(buildWorkbook({ Vazia: [] }));
    expect(() => parseProductWorkbook(wb)).toThrow(NO_VALID_PRODUCTS_ERROR);
  });

  test('planilha só com cabeçalho lança erro de "nenhum produto válido"', () => {
    const wb = roundTripXlsx(buildWorkbook({ P: [['Nome', 'EAN', 'Estoque Mínimo']] }));
    expect(() => parseProductWorkbook(wb)).toThrow(NO_VALID_PRODUCTS_ERROR);
  });

  test('CSV vazio lança erro de "nenhum produto válido"', () => {
    expect(() => parseProductWorkbook(readCsvAsArray(''))).toThrow(NO_VALID_PRODUCTS_ERROR);
  });

  test('XLSX hostil (aba e células "__proto__"/"constructor") não polui Object.prototype', () => {
    const wb = roundTripXlsx(
      buildWorkbook({
        // Chave computada: cria a aba "__proto__" de fato (e não troca o protótipo do literal)
        ['__proto__']: [
          ['__proto__', 'Nome', 'constructor'],
          ['{"polluted":true}', 'Produto Seguro', 'prototype'],
          ['polluted', '__proto__', 'isAdmin'],
        ],
      }),
    );
    const items = parseProductWorkbook(wb);
    expect(items.map((i) => i.name)).toEqual(['Produto Seguro', '__proto__']);
    expectPrototypeClean();
  });

  test('CSV hostil com chaves de protótipo não polui Object.prototype', () => {
    const csv =
      '__proto__,constructor,Nome\n' +
      'polluted,prototype,"__proto__"\n' +
      '"{""__proto__"":{""polluted"":1}}",x,Normal\n';
    const items = parseProductWorkbook(readCsvAsArray(csv));
    expect(items.map((i) => i.name)).toEqual(['__proto__', 'Normal']);
    expectPrototypeClean();
  });

  test('bytes aleatórios não travam o leitor nem poluem protótipos', () => {
    const garbage = new Uint8Array(4096);
    for (let i = 0; i < garbage.length; i++) garbage[i] = (i * 7919) % 256;
    let result: unknown;
    try {
      result = parseProductWorkbook(XLSX.read(garbage, { type: 'array' }));
    } catch (err) {
      // Erro é aceitável (vira mensagem na tela); travar ou poluir não é.
      expect(err).toBeInstanceOf(Error);
    }
    if (result) expect(Array.isArray(result)).toBe(true);
    expectPrototypeClean();
  });
});

describe('readProductFile: codificação e tipos do arquivo', () => {
  const CSV = 'Descrição;Código de Barras;Estoque Mínimo\nFeijão Carioca;0012345678905;1.000\nAçúcar Cristal;12345678901234567890;5\n';
  const EXPECTED = [
    { name: 'Feijão Carioca', variant: '', barcode: '0012345678905', min_stock: 1000 },
    { name: 'Açúcar Cristal', variant: '', barcode: '12345678901234567890', min_stock: 5 },
  ];

  /** Codifica em Windows-1252 (só caracteres Latin-1, suficientes para o teste). */
  const windows1252 = (text: string) => Uint8Array.from(text, (ch) => ch.charCodeAt(0));

  test('CSV UTF-8 sem BOM mantém os acentos e reconhece o cabeçalho', () => {
    expect(parseProductWorkbook(readProductFile(utf8Bytes(CSV)))).toEqual(EXPECTED);
  });

  test('CSV UTF-8 com BOM', () => {
    expect(parseProductWorkbook(readProductFile(utf8Bytes('\uFEFF' + CSV)))).toEqual(EXPECTED);
  });

  test('CSV Windows-1252 (padrão do Excel em português)', () => {
    expect(parseProductWorkbook(readProductFile(windows1252(CSV)))).toEqual(EXPECTED);
  });

  test('texto Unicode do Excel (UTF-16 LE com BOM, separado por tabulação)', () => {
    const tsv = '\uFEFF' + CSV.replace(/;/g, '\t');
    const bytes = new Uint8Array(tsv.length * 2);
    for (let i = 0; i < tsv.length; i++) {
      bytes[2 * i] = tsv.charCodeAt(i) & 0xff;
      bytes[2 * i + 1] = tsv.charCodeAt(i) >> 8;
    }
    expect(parseProductWorkbook(readProductFile(bytes.subarray(0)))).toEqual(EXPECTED);
  });

  test('CSV preserva zeros à esquerda e códigos longos (não converte em número)', () => {
    const items = parseProductWorkbook(readProductFile(utf8Bytes('Nome,EAN\nA,0001\nB,7891234567890123\n')));
    expect(items.map((i) => i.barcode)).toEqual(['0001', '7891234567890123']);
  });

  test('XLSX: código com formato "0000000000000" mantém os zeros; formato Geral não vira notação científica', () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Nome', 'EAN', 'Mínimo'],
      ['Com zeros', 12345678905, 3],
      ['Geral', 7891234567890, 4],
    ]);
    ws.B2.z = '0000000000000';
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Produtos');
    const bytes = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
    expect(parseProductWorkbook(readProductFile(bytes))).toEqual([
      { name: 'Com zeros', variant: '', barcode: '0012345678905', min_stock: 3 },
      { name: 'Geral', variant: '', barcode: '7891234567890', min_stock: 4 },
    ]);
  });

  test('XLS antigo (BIFF8) também é lido como planilha binária', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Nome'], ['Óleo de Soja']]), 'P');
    const bytes = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'biff8' }));
    expect(parseProductWorkbook(readProductFile(bytes)).map((i) => i.name)).toEqual(['Óleo de Soja']);
  });
});

describe('decodificadores de texto', () => {
  test('decodeUtf8 aceita UTF-8 válido, inclusive emoji', () => {
    const text = 'Pão de queijo 🧀 — R$ 5,00';
    expect(decodeUtf8(utf8Bytes(text))).toBe(text);
  });

  test('decodeUtf8 recusa sequências inválidas (truncadas, overlong, surrogates, bytes soltos)', () => {
    for (const bytes of [[0xc3], [0xe2, 0x82], [0xc0, 0x80], [0xed, 0xa0, 0x80], [0xe9, 0x61], [0xff], [0xf5, 0x80, 0x80, 0x80]]) {
      expect(decodeUtf8(Uint8Array.from(bytes))).toBeNull();
    }
  });

  test('decodeWindows1252 mapeia a faixa 0x80–0x9F e o Latin-1', () => {
    expect(decodeWindows1252(Uint8Array.from([0x80, 0x93, 0x94, 0x96, 0xe7, 0xe3]))).toBe('€“”–çã');
  });

  test('decodeText concorda com o TextDecoder para UTF-8 e Windows-1252', () => {
    const sample = Uint8Array.from({ length: 256 }, (_, i) => i).filter((b) => b !== 0x81 && b !== 0x8d && b !== 0x8f && b !== 0x90 && b !== 0x9d);
    expect(decodeText(sample)).toBe(new TextDecoder('windows-1252').decode(sample));
    const utf8 = utf8Bytes('Ação, café e maçã');
    expect(decodeText(utf8)).toBe(new TextDecoder('utf-8').decode(utf8));
  });
});
