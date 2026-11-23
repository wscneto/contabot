import React, { useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as XLSX from 'xlsx';
import { api, ImportProductItem } from '../../../services/api';
import { Header } from '../../../components/Header';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { showMessage } from '../../../utils/confirm';
import { parseProductWorkbook, readProductFile } from '../../../utils/product-import';
import { base64ToBytes } from '../../../utils/base64';
import { colors, typography } from '../../../constants/theme';

const readUriAsBase64 = async (rawUri: string): Promise<string> => {
  const uri =
    rawUri.startsWith('file://') || rawUri.startsWith('content://')
      ? encodeURI(decodeURI(rawUri))
      : rawUri;

  // 1. Tenta fetch + blob + FileReader (contorna sandbox do Expo Go no Android)
  try {
    const res = await fetch(uri);
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result;
        if (typeof result === 'string') {
          const base64 = result.includes(',') ? result.split(',')[1] : result;
          resolve(base64);
        } else {
          reject(new Error('Resultado inválido ao converter blob para base64.'));
        }
      };
      reader.onerror = (e) => reject(e || new Error('Falha no FileReader.'));
      reader.readAsDataURL(blob);
    });
  } catch (fetchErr) {
    console.warn(
      '[ImportProducts] fetch() não conseguiu ler URI, tentando XMLHttpRequest...',
      fetchErr
    );
  }

  // 2. Tenta XMLHttpRequest com responseType blob
  try {
    return await new Promise<string>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.onload = () => {
        const blob = xhr.response;
        if (!blob) {
          return reject(new Error('Blob vazio retornado pelo XHR.'));
        }
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result;
          if (typeof result === 'string') {
            const base64 = result.includes(',') ? result.split(',')[1] : result;
            resolve(base64);
          } else {
            reject(new Error('Resultado inválido no FileReader XHR.'));
          }
        };
        reader.onerror = (e) => reject(e || new Error('Falha no FileReader XHR.'));
        reader.readAsDataURL(blob);
      };
      xhr.onerror = (e) => reject(e || new Error('Falha no XMLHttpRequest para URI.'));
      xhr.responseType = 'blob';
      xhr.open('GET', uri, true);
      xhr.send(null);
    });
  } catch (xhrErr) {
    console.warn(
      '[ImportProducts] XMLHttpRequest falhou, tentando FileSystem legado...',
      xhrErr
    );
  }

  // 3. Fallback: FileSystem.readAsStringAsync legado
  return await FileSystem.readAsStringAsync(rawUri, {
    encoding: 'base64',
  });
};

export default function ImportProductsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [fileName, setFileName] = useState<string | null>(null);
  const [fileSize, setFileSize] = useState<number | null>(null);
  const [parsedItems, setParsedItems] = useState<ImportProductItem[]>([]);
  const [loadingFile, setLoadingFile] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePickFile = async () => {
    setError(null);
    try {
      setLoadingFile(true);
      const res = await DocumentPicker.getDocumentAsync({
        type: [
          'text/csv',
          'text/comma-separated-values',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-excel',
          'application/csv',
          '*/*',
        ],
        copyToCacheDirectory: true,
      });

      if (res.canceled || !res.assets || res.assets.length === 0) {
        return;
      }

      const asset = res.assets[0];

      let workbook: XLSX.WorkBook;

      if (Platform.OS === 'web') {
        // No navegador web, lê o ArrayBuffer diretamente do File ou do blob URI
        let arrayBuffer: ArrayBuffer;
        if ((asset as any).file && typeof (asset as any).file.arrayBuffer === 'function') {
          arrayBuffer = await (asset as any).file.arrayBuffer();
        } else {
          const fetchRes = await fetch(asset.uri);
          arrayBuffer = await fetchRes.arrayBuffer();
        }
        workbook = readProductFile(new Uint8Array(arrayBuffer));
      } else {
        // No ambiente mobile nativo (Android / iOS):
        // Usa readUriAsBase64 para contornar a restrição de sandbox do Expo Go no Android
        const base64 = await readUriAsBase64(asset.uri);
        workbook = readProductFile(base64ToBytes(base64));
      }

      // Lança erro com mensagem amigável se não houver abas ou produtos válidos
      const items = parseProductWorkbook(workbook);

      setFileName(asset.name);
      setFileSize(asset.size ?? null);
      setParsedItems(items);
    } catch (err: any) {
      console.error('[ImportProducts] Erro ao ler arquivo:', err);
      const msg = err.message || 'Falha ao processar o arquivo.';
      setError(msg);
      setFileName(null);
      setFileSize(null);
      setParsedItems([]);
      showMessage('Erro ao ler arquivo', msg);
    } finally {
      setLoadingFile(false);
    }
  };

  const handleClearFile = () => {
    setFileName(null);
    setFileSize(null);
    setParsedItems([]);
    setError(null);
  };

  const handleConfirmImport = async () => {
    if (parsedItems.length === 0) {
      showMessage('Atenção', 'Selecione um arquivo com ao menos um produto válido.');
      return;
    }

    setImporting(true);
    setError(null);
    try {
      const res = await api.importProducts(parsedItems);
      queryClient.invalidateQueries({ queryKey: ['manager_products'] });
      queryClient.invalidateQueries({ queryKey: ['manager_dashboard'] });

      showMessage(
        'Importação Concluída',
        `${res.count} produtos foram cadastrados no catálogo!\n\nEles estão marcados como "Foto pendente". Adicione fotos da embalagem a qualquer momento para que a IA possa reconhecê-los nas contagens.`,
        () => router.back()
      );
    } catch (err: any) {
      const msg = err.message || 'Falha ao cadastrar produtos em lote.';
      setError(msg);
      showMessage('Erro na importação', msg);
    } finally {
      setImporting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <Header title="Importar por Arquivo" showBack />

      <ScrollView contentContainerStyle={styles.content}>
        {/* Info Card */}
        <Card style={styles.infoCard}>
          <View style={styles.infoHeader}>
            <Ionicons name="document-text-outline" size={24} color={colors.primary} />
            <Text style={styles.infoTitle}>Como funciona a importação</Text>
          </View>
          <Text style={styles.infoText}>
            Envie uma planilha <Text style={styles.bold}>Excel (.xlsx/.xls)</Text> ou arquivo{' '}
            <Text style={styles.bold}>CSV (.csv)</Text> contendo os nomes dos produtos.
          </Text>
          <View style={styles.ruleItem}>
            <Ionicons name="checkmark-circle-outline" size={16} color={colors.success} />
            <Text style={styles.ruleText}>
              <Text style={styles.bold}>Coluna de Nomes:</Text> Obrigatória (ex: &quot;Nome&quot;, &quot;Descrição&quot;, &quot;Produto&quot;).
            </Text>
          </View>
          <View style={styles.ruleItem}>
            <Ionicons name="checkmark-circle-outline" size={16} color={colors.success} />
            <Text style={styles.ruleText}>
              <Text style={styles.bold}>Colunas Opcionais:</Text> Variante, Código de Barras (EAN) e
              Estoque Mínimo.
            </Text>
          </View>
          <View style={styles.warningBox}>
            <Ionicons name="camera-outline" size={18} color={colors.warningText} />
            <Text style={styles.warningText}>
              Produtos cadastrados por planilha ficam com <Text style={styles.bold}>Foto pendente</Text>.
              Eles não poderão ser contados pela IA até que você fotografe suas embalagens.
            </Text>
          </View>
        </Card>

        {/* Error Banner */}
        {error && (
          <Card style={styles.errorCard}>
            <View style={styles.errorHeader}>
              <Ionicons name="alert-circle-outline" size={20} color={colors.danger} />
              <Text style={styles.errorTitle}>Erro ao processar arquivo</Text>
            </View>
            <Text style={styles.errorText}>{error}</Text>
          </Card>
        )}

        {/* File Picker Section */}
        <TouchableOpacity
          style={[styles.pickerBox, fileName && styles.pickerBoxSelected]}
          onPress={handlePickFile}
          disabled={loadingFile || importing}
        >
          {loadingFile ? (
            <>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={styles.pickerTitle}>Lendo planilha...</Text>
              <Text style={styles.pickerSubtitle}>Processando linhas e colunas</Text>
            </>
          ) : (
            <>
              <Ionicons
                name={fileName ? 'document-attach' : 'cloud-upload-outline'}
                size={36}
                color={fileName ? colors.success : colors.primary}
              />
              <Text style={styles.pickerTitle}>
                {fileName ? fileName : 'Selecionar Planilha (.csv, .xlsx ou .xls)'}
              </Text>
              <Text style={styles.pickerSubtitle}>
                {fileSize
                  ? `${(fileSize / 1024).toFixed(1)} KB · Toque para trocar de arquivo`
                  : 'Toque para buscar no seu dispositivo'}
              </Text>
            </>
          )}
        </TouchableOpacity>

        {/* Parsed List Preview */}
        {parsedItems.length > 0 && (
          <View style={styles.previewSection}>
            <View style={styles.previewHeaderRow}>
              <Text style={styles.previewSectionTitle}>
                Produtos Encontrados ({parsedItems.length})
              </Text>
              <TouchableOpacity onPress={handleClearFile} style={styles.clearBtn}>
                <Ionicons name="close-circle-outline" size={16} color={colors.textMuted} />
                <Text style={styles.clearBtnText}>Trocar arquivo</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.previewList}>
              {parsedItems.slice(0, 50).map((item, idx) => (
                <View key={idx} style={styles.previewRow}>
                  <View style={styles.previewIndex}>
                    <Text style={styles.previewIndexText}>{idx + 1}</Text>
                  </View>
                  <View style={styles.previewInfo}>
                    <Text style={styles.previewName}>{item.name}</Text>
                    <View style={styles.previewMetaRow}>
                      {item.variant ? (
                        <Text style={styles.previewMeta}>Var: {item.variant} · </Text>
                      ) : null}
                      {item.barcode ? (
                        <Text style={styles.previewMeta}>EAN: {item.barcode} · </Text>
                      ) : null}
                      <Text style={styles.previewMeta}>
                        Mín: {item.min_stock !== null ? item.min_stock : '—'}
                      </Text>
                    </View>
                  </View>
                </View>
              ))}

              {parsedItems.length > 50 && (
                <Text style={styles.moreText}>
                  + {parsedItems.length - 50} outros produtos serão importados...
                </Text>
              )}
            </View>

            <Button
              title={`Confirmar e Importar ${parsedItems.length} Produtos`}
              onPress={handleConfirmImport}
              loading={importing}
              size="lg"
              style={styles.importBtn}
            />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  infoCard: {
    padding: 16,
    marginBottom: 16,
  },
  infoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  infoTitle: {
    ...typography.h3,
    fontSize: 16,
    color: colors.textPrimary,
  },
  infoText: {
    ...typography.body,
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 12,
    lineHeight: 19,
  },
  ruleItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  ruleText: {
    ...typography.caption,
    fontSize: 12,
    color: colors.textSecondary,
    flex: 1,
  },
  bold: {
    fontWeight: '700',
    color: colors.textPrimary,
  },
  warningBox: {
    marginTop: 12,
    backgroundColor: colors.warningBg,
    borderRadius: 8,
    padding: 10,
    flexDirection: 'row',
    gap: 8,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  warningText: {
    ...typography.caption,
    fontSize: 12,
    color: colors.warningText,
    flex: 1,
    lineHeight: 17,
  },
  errorCard: {
    padding: 14,
    marginBottom: 16,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  errorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  errorTitle: {
    ...typography.h3,
    fontSize: 14,
    color: colors.danger,
  },
  errorText: {
    ...typography.caption,
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 17,
  },
  pickerBox: {
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.surfaceBorderStrong,
    borderStyle: 'dashed',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  pickerBoxSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.surfaceSubtle,
  },
  pickerTitle: {
    ...typography.h3,
    fontSize: 15,
    marginTop: 10,
    textAlign: 'center',
    color: colors.primary,
  },
  pickerSubtitle: {
    ...typography.caption,
    marginTop: 4,
    color: colors.textMuted,
    textAlign: 'center',
  },
  previewSection: {
    marginTop: 6,
  },
  previewHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  previewSectionTitle: {
    ...typography.h3,
    fontSize: 15,
    color: colors.textPrimary,
  },
  clearBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  clearBtnText: {
    fontSize: 12,
    color: colors.textMuted,
  },
  previewList: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    overflow: 'hidden',
    marginBottom: 16,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceBorder,
  },
  previewIndex: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.surfaceSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  previewIndexText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
  },
  previewInfo: {
    flex: 1,
  },
  previewName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  previewMetaRow: {
    flexDirection: 'row',
    marginTop: 2,
  },
  previewMeta: {
    fontSize: 12,
    color: colors.textMuted,
  },
  moreText: {
    padding: 12,
    textAlign: 'center',
    ...typography.caption,
    color: colors.textMuted,
    fontStyle: 'italic',
  },
  importBtn: {
    marginTop: 8,
  },
});
