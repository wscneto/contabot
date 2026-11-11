import React, { useState } from 'react';
import {
  Alert,
  FlatList,
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
import * as FileSystem from 'expo-file-system';
import * as XLSX from 'xlsx';
import { api, ImportProductItem } from '../../../services/api';
import { Header } from '../../../components/Header';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { colors, typography } from '../../../constants/theme';

export default function ImportProductsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [fileName, setFileName] = useState<string | null>(null);
  const [fileSize, setFileSize] = useState<number | null>(null);
  const [parsedItems, setParsedItems] = useState<ImportProductItem[]>([]);
  const [loadingFile, setLoadingFile] = useState(false);
  const [importing, setImporting] = useState(false);

  const parseSheetRows = (rawRows: any[][]): ImportProductItem[] => {
    if (!rawRows || rawRows.length === 0) return [];

    const headerRow = rawRows[0] || [];
    let nameIdx = -1;
    let variantIdx = -1;
    let barcodeIdx = -1;
    let minStockIdx = -1;

    headerRow.forEach((col: any, idx: number) => {
      const str = String(col || '').toLowerCase().trim();
      if (/nome|produto|product|item|descri/i.test(str) && nameIdx === -1) {
        nameIdx = idx;
      } else if (/variante|variant|gramatura|peso|apresenta/i.test(str) && variantIdx === -1) {
        variantIdx = idx;
      } else if (/c[oó]digo|ean|barcode|gtin|barras/i.test(str) && barcodeIdx === -1) {
        barcodeIdx = idx;
      } else if (/m[ií]nimo|min_stock|estoque_min|min/i.test(str) && minStockIdx === -1) {
        minStockIdx = idx;
      }
    });

    let startRow = 1;
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

      const rawVariant =
        variantIdx !== -1 && row[variantIdx] !== undefined ? String(row[variantIdx]).trim() : '';
      const rawBarcode =
        barcodeIdx !== -1 && row[barcodeIdx] !== undefined ? String(row[barcodeIdx]).trim() : '';
      let minStock: number | null = null;
      if (minStockIdx !== -1 && row[minStockIdx] !== undefined) {
        const parsed = parseInt(String(row[minStockIdx]).replace(/\D/g, ''), 10);
        if (!isNaN(parsed) && parsed >= 0) minStock = parsed;
      }

      items.push({
        name: rawName,
        variant: rawVariant,
        barcode: rawBarcode,
        min_stock: minStock,
      });
    }
    return items;
  };

  const handlePickFile = async () => {
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
      setFileName(asset.name);
      setFileSize(asset.size ?? null);

      // Ler conteúdo como base64
      const base64 = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: 'base64',
      });

      const workbook = XLSX.read(base64, { type: 'base64' });
      if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
        throw new Error('Nenhuma planilha encontrada no arquivo selecionado.');
      }

      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawRows = XLSX.utils.sheet_to_json<any[]>(firstSheet, { header: 1 });
      const items = parseSheetRows(rawRows);

      if (items.length === 0) {
        throw new Error('Nenhum produto válido foi identificado nas linhas do arquivo.');
      }

      setParsedItems(items);
    } catch (err: any) {
      Alert.alert('Erro ao ler arquivo', err.message || 'Falha ao processar o arquivo.');
    } finally {
      setLoadingFile(false);
    }
  };

  const handleConfirmImport = async () => {
    if (parsedItems.length === 0) {
      Alert.alert('Atenção', 'Selecione um arquivo com ao menos um produto válido.');
      return;
    }

    setImporting(true);
    try {
      const res = await api.importProducts(parsedItems);
      queryClient.invalidateQueries({ queryKey: ['manager_products'] });
      queryClient.invalidateQueries({ queryKey: ['manager_dashboard'] });

      Alert.alert(
        'Importação Concluída',
        `${res.count} produtos foram cadastrados no catálogo!\n\nEles estão marcados como "Foto pendente". Adicione fotos da embalagem a qualquer momento para que a IA possa reconhecê-los nas contagens.`,
        [{ text: 'OK', onPress: () => router.back() }]
      );
    } catch (err: any) {
      Alert.alert('Erro na importação', err.message || 'Falha ao cadastrar produtos em lote.');
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
            Envie uma planilha <Text style={styles.bold}>Excel (.xlsx)</Text> ou arquivo{' '}
            <Text style={styles.bold}>CSV (.csv)</Text> contendo os nomes dos produtos.
          </Text>
          <View style={styles.ruleItem}>
            <Ionicons name="checkmark-circle-outline" size={16} color={colors.success} />
            <Text style={styles.ruleText}>
              <Text style={styles.bold}>Coluna de Nomes:</Text> Obrigatória (ex: "Nome", "Produto").
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

        {/* File Picker Section */}
        <TouchableOpacity
          style={styles.pickerBox}
          onPress={handlePickFile}
          disabled={loadingFile || importing}
        >
          <Ionicons
            name={fileName ? 'document-attach' : 'cloud-upload-outline'}
            size={36}
            color={fileName ? colors.success : colors.primary}
          />
          <Text style={styles.pickerTitle}>
            {fileName ? fileName : 'Selecionar Planilha (.csv ou .xlsx)'}
          </Text>
          <Text style={styles.pickerSubtitle}>
            {fileSize
              ? `${(fileSize / 1024).toFixed(1)} KB · Toque para trocar de arquivo`
              : 'Toque para buscar no seu dispositivo'}
          </Text>
        </TouchableOpacity>

        {/* Parsed List Preview */}
        {parsedItems.length > 0 && (
          <View style={styles.previewSection}>
            <View style={styles.previewHeaderRow}>
              <Text style={styles.previewSectionTitle}>
                Produtos Encontrados ({parsedItems.length})
              </Text>
              <View style={styles.pendingBadge}>
                <Ionicons name="time-outline" size={12} color={colors.warningText} />
                <Text style={styles.pendingBadgeText}>Fotos Pendentes</Text>
              </View>
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
  pendingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.warningBg,
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  pendingBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.warningText,
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
