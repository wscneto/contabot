import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { api } from '../services/api';
import { buildApprovedTaskCsv, buildFilename } from './approved-task-csv';

export { buildApprovedTaskCsv } from './approved-task-csv';

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
    // Revogar na hora pode cancelar o download em alguns navegadores (Firefox).
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }

  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Compartilhamento de arquivos não disponível neste aparelho.');
  }

  const file = new File(Paths.cache, filename);
  file.create({ overwrite: true });
  await file.write(csv);

  await Sharing.shareAsync(file.uri, {
    mimeType: 'text/csv',
    dialogTitle: 'Exportar contagem em CSV',
    UTI: 'public.comma-separated-values-text',
  });
}
