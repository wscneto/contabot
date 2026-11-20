import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { api, type ApprovedTaskExport } from '../services/api';

function escapeCsvCell(value: string | number): string {
  const str = String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildFilename(areaName: string, approvedAt: string | null): string {
  const slug = areaName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'contagem';
  const datePart = (approvedAt ?? new Date().toISOString()).slice(0, 10);
  return `contagem-${slug}-${datePart}.csv`;
}

/** Gera CSV UTF-8 com BOM contendo código de barras, nome e quantidade. */
export function buildApprovedTaskCsv(data: ApprovedTaskExport): string {
  const header = ['codigo_de_barras', 'nome', 'quantidade'].join(',');
  const rows = data.items.map((item) => {
    const variant = item.variant?.trim();
    const displayName = variant ? `${item.name} (${variant})` : item.name;
    return [
      escapeCsvCell(item.barcode ?? ''),
      escapeCsvCell(displayName),
      escapeCsvCell(item.quantity ?? 0),
    ].join(',');
  });
  return `\uFEFF${[header, ...rows].join('\r\n')}\r\n`;
}

/**
 * Busca os itens da contagem aprovada (somente gerente no backend) e exporta
 * o CSV para download na Web ou compartilhamento nativo no celular.
 */
export async function exportApprovedTaskCsv(taskId: string): Promise<void> {
  const data = await api.exportApprovedTask(taskId);
  const csv = buildApprovedTaskCsv(data);
  const filename = buildFilename(data.area_name, data.approved_at);

  if (Platform.OS === 'web') {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    return;
  }

  const file = new File(Paths.cache, filename);
  file.create({ overwrite: true });
  await file.write(csv);

  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Compartilhamento de arquivos não disponível neste aparelho.');
  }

  await Sharing.shareAsync(file.uri, {
    mimeType: 'text/csv',
    dialogTitle: 'Exportar contagem em CSV',
    UTI: 'public.comma-separated-values-text',
  });
}
