/**
 * Conversão de planilhas (XLSX/XLS/CSV) em itens de importação de produtos.
 *
 * Funções puras, sem dependência de tela ou de módulos nativos: a tela
 * `products/import.tsx` só lê o arquivo e chama `XLSX.read`; o restante fica
 * aqui para poder ser testado isoladamente.
 */
import * as XLSX from 'xlsx';
import type { ImportProductItem } from '../services/api';

export const NO_SHEETS_ERROR = 'Nenhuma planilha encontrada no arquivo selecionado.';
export const NO_VALID_PRODUCTS_ERROR = 'Nenhum produto válido foi identificado nas linhas do arquivo.';

/** Rótulos de cabeçalho que nunca viram produto, mesmo se repetidos no meio da planilha. */
const HEADER_LABELS = new Set(['descrição', 'descricao', 'nome', 'produto']);

const cellText = (col: unknown): string => String(col || '').toLowerCase().trim();

/** Primeiro índice cuja célula satisfaz `test`, ou -1. */
const findColumn = (headerRow: unknown[], test: (str: string) => boolean): number => {
  let found = -1;
  headerRow.forEach((col, idx) => {
    if (found === -1 && test(cellText(col))) found = idx;
  });
  return found;
};

/**
 * Converte as linhas brutas de uma aba (`sheet_to_json` com `header: 1`) em
 * itens de importação.
 *
 * - O cabeçalho é a primeira das 5 primeiras linhas com alguma palavra-chave
 *   (descrição, nome, produto, código de barras, EAN, SAP...). Sem nenhuma,
 *   assume a linha 0.
 * - Sem coluna de nome reconhecida, usa a primeira coluna e trata todas as
 *   linhas (inclusive a 0) como dados.
 * - Linhas sem nome, ou cujo nome é um rótulo de cabeçalho, são ignoradas.
 */
export function parseSheetRows(rawRows: unknown[][]): ImportProductItem[] {
  if (!rawRows || rawRows.length === 0) return [];

  // Localiza a linha do cabeçalho nas primeiras 5 linhas que contenham palavras-chave
  let headerRowIdx = 0;
  for (let r = 0; r < Math.min(rawRows.length, 5); r++) {
    const row = rawRows[r] || [];
    const hasKeywords = row.some((col) =>
      /descri|nome|produto|product|barcode|barra|ean|sap/i.test(cellText(col)),
    );
    if (hasKeywords) {
      headerRowIdx = r;
      break;
    }
  }

  const headerRow = rawRows[headerRowIdx] || [];

  // 1. Nome/Descrição: priorizar 'descrição', 'descricao', 'nome'
  let nameIdx = findColumn(headerRow, (str) => /descri|nome/i.test(str) && !/c[oó]d/i.test(str));

  // Se não encontrou 'descrição'/'nome', procura 'produto' ou 'item' (sem ser código)
  if (nameIdx === -1) {
    nameIdx = findColumn(headerRow, (str) => /produto|product|item/i.test(str) && !/c[oó]d/i.test(str));
  }

  // 2. Código de barras / EAN
  const barcodeIdx = findColumn(headerRow, (str) => /barra|ean|gtin|barcode/i.test(str));

  // 3. Variante / Gramatura
  const variantIdx = findColumn(headerRow, (str) => /variante|variant|gramatura|peso|apresenta/i.test(str));

  // 4. Estoque mínimo / Mínimo
  const minStockIdx = findColumn(headerRow, (str) => /m[ií]nimo|min_stock|estoque_min/i.test(str));

  let startRow = headerRowIdx + 1;
  if (nameIdx === -1) {
    nameIdx = 0;
    startRow = 0;
  }

  const items: ImportProductItem[] = [];
  for (let i = startRow; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!row || row.length === 0) continue;
    const rawName = row[nameIdx] !== undefined ? String(row[nameIdx]).trim() : '';
    if (!rawName) continue;

    // Ignora se o nome for idêntico ao rótulo do cabeçalho
    if (HEADER_LABELS.has(rawName.toLowerCase())) continue;

    const rawVariant =
      variantIdx !== -1 && row[variantIdx] !== undefined ? String(row[variantIdx]).trim() : '';
    const rawBarcode =
      barcodeIdx !== -1 && row[barcodeIdx] !== undefined ? String(row[barcodeIdx]).trim() : '';

    items.push({
      name: rawName,
      variant: rawVariant,
      barcode: rawBarcode,
      min_stock: minStockIdx !== -1 ? parseMinStock(row[minStockIdx]) : null,
    });
  }
  return items;
}

/** Maior estoque mínimo aceito (mesmo limite do servidor). */
export const MAX_MIN_STOCK = 1_000_000;

/**
 * Estoque mínimo de uma célula, ou `null` se ausente ou inválido.
 *
 * - Número: inteiro entre 0 e 1.000.000.
 * - Texto: um único número, com unidade opcional ("10 unidades", "cx 3").
 *   Segue a convenção brasileira: "1.000" é mil e a vírgula é decimal, então
 *   "5,0" vira 5. Negativos ("-5"), frações ("2,5", "2.5") e textos com mais
 *   de um número são recusados, em vez de virarem outro valor.
 */
export function parseMinStock(cell: unknown): number | null {
  if (typeof cell === 'number') {
    return Number.isInteger(cell) && cell >= 0 && cell <= MAX_MIN_STOCK ? cell : null;
  }
  if (typeof cell !== 'string') return null;
  const tokens = cell.match(/-?\d[\d.,]*/g);
  if (!tokens || tokens.length !== 1) return null;
  let token = tokens[0].replace(/[.,]$/, '');
  if (token.startsWith('-')) return null;
  if (/^\d{1,3}(\.\d{3})+$/.test(token)) token = token.replace(/\./g, ''); // milhar: 1.000
  const integer = token.match(/^(\d+)(?:[.,]0+)?$/);
  if (!integer) return null;
  const value = Number(integer[1]);
  return value <= MAX_MIN_STOCK ? value : null;
}

/**
 * Linhas brutas da primeira aba com conteúdo. Se a primeira aba estiver vazia,
 * procura nas seguintes; se todas estiverem vazias, devolve as linhas (vazias)
 * da primeira.
 */
export function getFirstNonEmptySheetRows(workbook: XLSX.WorkBook): unknown[][] {
  let rawRows = sheetRows(workbook.Sheets[workbook.SheetNames[0]]);

  if ((!rawRows || rawRows.length === 0) && workbook.SheetNames.length > 1) {
    for (let s = 1; s < workbook.SheetNames.length; s++) {
      const rows = sheetRows(workbook.Sheets[workbook.SheetNames[s]]);
      if (rows && rows.length > 0) {
        rawRows = rows;
        break;
      }
    }
  }
  return rawRows;
}

/**
 * Linhas de uma aba. Células numéricas cujo texto exibido é só de dígitos usam
 * esse texto: um código de barras com formato "0000000000000" mantém os zeros à
 * esquerda. No formato Geral o texto exibido vira notação científica
 * ("7.89123E+12"), e então fica o número.
 */
function sheetRows(sheet: XLSX.WorkSheet | undefined): unknown[][] {
  if (!sheet) return [];
  const values = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });
  const shown = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false });
  return values.map((row, r) =>
    row.map((value, c) => {
      const text = shown[r]?.[c];
      return typeof value === 'number' && typeof text === 'string' && /^\d+$/.test(text) ? text : value;
    }),
  );
}

/**
 * Extrai os produtos de uma pasta de trabalho já lida com `XLSX.read`.
 * Lança erro (com mensagem para o usuário) se não houver abas ou nenhum
 * produto válido.
 */
export function parseProductWorkbook(workbook: XLSX.WorkBook): ImportProductItem[] {
  if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
    throw new Error(NO_SHEETS_ERROR);
  }

  const items = parseSheetRows(getFirstNonEmptySheetRows(workbook));

  if (items.length === 0) {
    throw new Error(NO_VALID_PRODUCTS_ERROR);
  }
  return items;
}

// ---------------------------------------------------------------------------
// Leitura do arquivo
// ---------------------------------------------------------------------------

/**
 * Lê o arquivo escolhido pelo usuário. XLSX/ODS (ZIP) e XLS (OLE2) vão direto
 * para o SheetJS. Texto (CSV/TSV) é decodificado aqui e lido sem conversão de
 * tipos, para preservar zeros à esquerda e códigos longos ("0012345678905").
 */
export function readProductFile(bytes: Uint8Array): XLSX.WorkBook {
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const isOle = bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
  if (isZip || isOle) return XLSX.read(bytes, { type: 'array' });
  return XLSX.read(decodeText(bytes), { type: 'string', raw: true });
}

/**
 * Texto de um CSV em qualquer das codificações que o Excel e o Google Planilhas
 * geram: UTF-8 com ou sem BOM, UTF-16 LE com BOM ("Texto Unicode") ou
 * Windows-1252 (o "CSV" padrão do Excel em português). Sem BOM, tenta UTF-8
 * estrito e recorre ao Windows-1252 se os bytes não forem UTF-8 válido.
 */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return decodeUtf8(bytes.subarray(3)) ?? decodeWindows1252(bytes.subarray(3));
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return decodeUtf16le(bytes.subarray(2));
  return decodeUtf8(bytes) ?? decodeWindows1252(bytes);
}

/** UTF-8 estrito; `null` se houver sequência inválida. */
export function decodeUtf8(bytes: Uint8Array): string | null {
  const codes: number[] = [];
  let out = '';
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i];
    let cp: number;
    let extra: number;
    let min: number;
    if (b < 0x80) {
      cp = b;
      extra = 0;
      min = 0;
    } else if (b >= 0xc2 && b <= 0xdf) {
      cp = b & 0x1f;
      extra = 1;
      min = 0x80;
    } else if (b >= 0xe0 && b <= 0xef) {
      cp = b & 0x0f;
      extra = 2;
      min = 0x800;
    } else if (b >= 0xf0 && b <= 0xf4) {
      cp = b & 0x07;
      extra = 3;
      min = 0x10000;
    } else {
      return null;
    }
    for (let k = 1; k <= extra; k++) {
      const next = bytes[i + k];
      if (next === undefined || (next & 0xc0) !== 0x80) return null;
      cp = (cp << 6) | (next & 0x3f);
    }
    if (cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return null;
    codes.push(cp);
    i += extra + 1;
    if (codes.length >= 4096) {
      out += String.fromCodePoint(...codes);
      codes.length = 0;
    }
  }
  return out + String.fromCodePoint(...codes);
}

/** Bytes 0x80–0x9F do Windows-1252 (o resto coincide com o Latin-1). */
const WINDOWS_1252_HIGH = [
  0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0x8d, 0x17d,
  0x8f, 0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0x9d,
  0x17e, 0x178,
];

export function decodeWindows1252(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 4096) {
    const chunk = Array.from(bytes.subarray(i, i + 4096), (b) =>
      b >= 0x80 && b <= 0x9f ? WINDOWS_1252_HIGH[b - 0x80] : b,
    );
    out += String.fromCharCode(...chunk);
  }
  return out;
}

function decodeUtf16le(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) out += String.fromCharCode(bytes[i] | (bytes[i + 1] << 8));
  return out;
}
