/**
 * Geração do CSV de uma contagem aprovada. Funções puras (sem módulo nativo),
 * separadas de `exportCsv.ts` para serem testadas no Jest.
 */

export interface ApprovedTaskExportItem {
  barcode: string;
  name: string;
  variant?: string | null;
  quantity: number;
}

export interface ApprovedTaskExport {
  id: string;
  area_name: string;
  approved_at: string | null;
  items: ApprovedTaskExportItem[];
}

/**
 * Planilhas executam como fórmula o texto que começa com =, +, -, @, tab ou CR
 * (injeção de CSV, OWASP). Um apóstrofo na frente faz o Excel, o LibreOffice e
 * o Google Planilhas tratarem a célula como texto.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

export function escapeCsvCell(value: string | number): string {
  let str = String(value);
  if (typeof value === 'string' && FORMULA_START.test(str)) str = `'${str}`;
  if (/[",\r\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

export function buildFilename(areaName: string, approvedAt: string | null, now = new Date()): string {
  const slug =
    areaName
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
      .replace(/-+$/, '') || 'contagem';
  const datePart = (approvedAt ?? now.toISOString()).slice(0, 10);
  return `contagem-${slug}-${datePart}.csv`;
}

/** Gera CSV UTF-8 com BOM contendo código de barras, nome e quantidade. */
export function buildApprovedTaskCsv(data: ApprovedTaskExport): string {
  const header = ['codigo_de_barras', 'nome', 'quantidade'].join(',');
  const rows = data.items.map((item) => {
    const variant = item.variant?.trim();
    const displayName = variant ? `${item.name} (${variant})` : item.name;
    return [escapeCsvCell(item.barcode ?? ''), escapeCsvCell(displayName), escapeCsvCell(item.quantity ?? 0)].join(',');
  });
  return `﻿${[header, ...rows].join('\r\n')}\r\n`;
}
