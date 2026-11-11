import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { api } from '../../../../services/api';
import { Header } from '../../../../components/Header';
import { Badge } from '../../../../components/Badge';
import { Stepper } from '../../../../components/Stepper';
import { Button } from '../../../../components/Button';
import { Card } from '../../../../components/Card';
import { colors, typography } from '../../../../constants/theme';
import { confirmAction, showMessage } from '../../../../utils/confirm';

export default function ReviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();

  // Local state for counts by product_id
  const [counts, setCounts] = useState<Record<string, number | null>>({});
  const [submitting, setSubmitting] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState<{ url: string; title: string } | null>(null);

  const { data: task, isLoading, refetch } = useQuery({
    queryKey: ['task_detail', id],
    queryFn: () => api.getTask(id),
    enabled: Boolean(id),
  });

  // Initialize counts from task items
  useEffect(() => {
    if (task && task.items) {
      const initialCounts: Record<string, number | null> = {};
      for (const item of task.items) {
        if (item.counted !== null && item.counted !== undefined) {
          initialCounts[item.product_id] = item.counted;
        } else if (item.ai_status === 'ok' && item.ai_quantity !== null) {
          initialCounts[item.product_id] = item.ai_quantity;
        } else {
          initialCounts[item.product_id] = null;
        }
      }
      setCounts(initialCounts);
    }
  }, [task]);

  if (isLoading || !task) {
    return (
      <SafeAreaView style={styles.container}>
        <Header title="Carregando…" showBack />
        <View style={styles.loadingCenter}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  const isReadOnly = task.status === 'submitted' || task.status === 'approved';

  const handleCountChange = (productId: string, val: number | null) => {
    setCounts((prev) => ({
      ...prev,
      [productId]: val,
    }));
  };

  const handleSubmit = async () => {
    // Check if any item is uncounted
    const uncounted = task.items.filter((item: any) => counts[item.product_id] === null);
    if (uncounted.length > 0) {
      confirmAction(
        'Itens Pendentes',
        `Ainda há ${uncounted.length} ${uncounted.length === 1 ? 'produto sem quantidade' : 'produtos sem quantidade'}. Deseja enviar mesmo assim?`,
        doSubmit,
        { confirmText: 'Enviar assim mesmo', cancelText: 'Revisar' },
      );
      return;
    }
    doSubmit();
  };

  const doSubmit = async () => {
    setSubmitting(true);
    try {
      await api.submitTask(id, counts);
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => null);
      }
      // Atualiza as listas antes de sair, para a contagem já aparecer como enviada.
      void queryClient.invalidateQueries();
      showMessage(
        'Contagem Enviada!',
        'Sua conferência foi enviada com sucesso e aguarda aprovação do gerente.',
        () => router.replace('/(employee)'),
      );
    } catch (err: any) {
      showMessage('Erro ao enviar', err.message || 'Falha no envio.');
    } finally {
      setSubmitting(false);
    }
  };

  const renderProductRow = ({ item }: { item: any }) => {
    const currentCount = counts[item.product_id] ?? null;
    const photoUrl = api.resolveMediaUrl(item.photo);
    const evidenceUrl = api.resolveMediaUrl(item.evidence_frame);

    return (
      <Card style={styles.productCard}>
        <View style={styles.cardTopRow}>
          {/* Photo */}
          <TouchableOpacity
            onPress={() => photoUrl && setSelectedPhoto({ url: photoUrl, title: item.name })}
            disabled={!photoUrl}
            style={styles.thumbTouchable}
          >
            {photoUrl ? (
              <Image source={{ uri: photoUrl }} style={styles.thumb} contentFit="cover" />
            ) : (
              <View style={styles.thumbEmpty}>
                <Ionicons name="cube-outline" size={24} color={colors.textMuted} />
              </View>
            )}
            <View style={styles.zoomBadge}>
              <Ionicons name="search" size={10} color="#FFF" />
            </View>
          </TouchableOpacity>

          {/* Details */}
          <View style={styles.prodDetails}>
            <Text style={styles.prodName}>{item.name}</Text>
            {item.variant ? <Text style={styles.prodVariant}>{item.variant}</Text> : null}

            <View style={styles.statusBadgeRow}>
              <Badge variant={item.ai_status} size="sm" />
              {item.ai_quantity !== null && (
                <Text style={styles.aiSuggestionText}>
                  IA sugeriu: <Text style={styles.bold}>{item.ai_quantity}</Text>
                </Text>
              )}
            </View>
          </View>
        </View>

        {/* AI Note / Reason */}
        {item.ai_note ? (
          <View
            style={[
              styles.aiNoteBox,
              item.ai_status === 'check' && styles.aiNoteWarning,
              item.ai_status === 'missing' && styles.aiNoteDanger,
            ]}
          >
            <Ionicons
              name={item.ai_status === 'check' ? 'warning-outline' : 'information-circle-outline'}
              size={15}
              color={
                item.ai_status === 'check'
                  ? colors.warningText
                  : item.ai_status === 'missing'
                  ? colors.dangerText
                  : colors.textSecondary
              }
            />
            <Text
              style={[
                styles.aiNoteText,
                item.ai_status === 'check' && { color: colors.warningText },
                item.ai_status === 'missing' && { color: colors.dangerText },
              ]}
              numberOfLines={2}
            >
              {item.ai_note}
            </Text>
          </View>
        ) : null}

        {/* Evidence Frame Link */}
        {evidenceUrl ? (
          <TouchableOpacity
            style={styles.evidenceBtn}
            onPress={() => setSelectedPhoto({ url: evidenceUrl, title: `Frame Usado: ${item.name}` })}
          >
            <Ionicons name="eye-outline" size={15} color={colors.primary} />
            <Text style={styles.evidenceBtnText}>Ver imagem de evidência da IA</Text>
          </TouchableOpacity>
        ) : null}

        {/* Stepper Input Row */}
        <View style={styles.stepperRow}>
          <Text style={styles.countLabel}>Quantidade Conferida:</Text>
          {isReadOnly ? (
            <Text style={styles.readOnlyCount}>
              {currentCount !== null ? `${currentCount} un.` : '—'}
            </Text>
          ) : (
            <Stepper
              value={currentCount}
              onChange={(val) => handleCountChange(item.product_id, val)}
            />
          )}
        </View>
      </Card>
    );
  };

  const countedCount = task.items.filter((item: any) => counts[item.product_id] !== null).length;
  const totalCount = task.items.length;

  return (
    // A borda inferior fica com a barra de ações, que soma o recuo do sistema.
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <Header
        title={task.area?.name || 'Conferência'}
        subtitle="Conferir e Confirmar Produtos"
        showBack
      />

      {isReadOnly && (
        <View style={styles.readOnlyBanner}>
          <Ionicons name="lock-closed" size={16} color={colors.purpleText} />
          <Text style={styles.readOnlyText}>
            {task.status === 'submitted'
              ? 'Contagem enviada ao gerente. Aguardando aprovação.'
              : 'Contagem aprovada e finalizada.'}
          </Text>
        </View>
      )}

      <FlatList
        data={task.items}
        keyExtractor={(item) => item.product_id}
        renderItem={renderProductRow}
        contentContainerStyle={[styles.listContent, { paddingBottom: 140 + insets.bottom }]}
        ListHeaderComponent={
          <View style={styles.listHeader}>
            <Text style={styles.guideTitle}>Conferência na Prateleira</Text>
            <Text style={styles.guideSubtitle}>
              Os valores marcados em verde foram identificados com clareza. Dê atenção especial aos itens com aviso amarelo ou vermelho.
            </Text>
          </View>
        }
      />

      {/* Floating Bottom Bar (Only if not read-only) */}
      {!isReadOnly && (
        <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 14) }]}>
          <View style={styles.progressRow}>
            <Text style={styles.progressText}>
              <Text style={styles.bold}>{countedCount}</Text> de {totalCount} conferidos
            </Text>
            {countedCount === totalCount && (
              <Ionicons name="checkmark-circle" size={16} color={colors.success} />
            )}
          </View>

          <View style={styles.buttonsRow}>
            <Button
              title="Refilmar"
              onPress={() => router.push(`/(employee)/task/${id}/camera`)}
              variant="outline"
              icon={<Ionicons name="videocam-outline" size={18} color={colors.textPrimary} />}
              style={styles.reRecordBtn}
            />

            <Button
              title="Enviar para o Gerente"
              onPress={handleSubmit}
              loading={submitting}
              iconRight={<Ionicons name="arrow-forward" size={18} color="#FFF" />}
              style={styles.submitBtn}
            />
          </View>
        </View>
      )}

      {/* Full Photo Modal */}
      <Modal
        visible={Boolean(selectedPhoto)}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedPhoto(null)}
      >
        <View style={styles.modalOverlay}>
          <SafeAreaView style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle} numberOfLines={1}>
                {selectedPhoto?.title}
              </Text>
              <TouchableOpacity onPress={() => setSelectedPhoto(null)} style={styles.modalCloseBtn}>
                <Ionicons name="close" size={24} color="#FFF" />
              </TouchableOpacity>
            </View>

            {selectedPhoto?.url && (
              <Image
                source={{ uri: selectedPhoto.url }}
                style={styles.modalImage}
                contentFit="contain"
              />
            )}
          </SafeAreaView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingCenter: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  readOnlyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.purpleBg,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceBorder,
  },
  readOnlyText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.purpleText,
    marginLeft: 8,
  },
  listContent: {
    padding: 16,
  },
  listHeader: {
    marginBottom: 16,
  },
  guideTitle: {
    ...typography.h3,
    fontSize: 17,
  },
  guideSubtitle: {
    ...typography.caption,
    marginTop: 4,
    lineHeight: 18,
  },
  productCard: {
    padding: 16,
    marginBottom: 14,
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  thumbTouchable: {
    position: 'relative',
    marginRight: 14,
  },
  thumb: {
    width: 64,
    height: 64,
    borderRadius: 10,
  },
  thumbEmpty: {
    width: 64,
    height: 64,
    borderRadius: 10,
    backgroundColor: colors.surfaceSubtle,
    justifyContent: 'center',
    alignItems: 'center',
  },
  zoomBadge: {
    position: 'absolute',
    bottom: -4,
    right: -4,
    backgroundColor: colors.textPrimary,
    width: 18,
    height: 18,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
  },
  prodDetails: {
    flex: 1,
  },
  prodName: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  prodVariant: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  statusBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  aiSuggestionText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  bold: {
    fontWeight: '700',
    color: colors.textPrimary,
  },
  aiNoteBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceSubtle,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 10,
  },
  aiNoteWarning: {
    backgroundColor: colors.warningBg,
  },
  aiNoteDanger: {
    backgroundColor: colors.dangerBg,
  },
  aiNoteText: {
    fontSize: 12,
    color: colors.textSecondary,
    marginLeft: 6,
    flex: 1,
  },
  evidenceBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    paddingVertical: 2,
  },
  evidenceBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.primary,
    marginLeft: 6,
  },
  stepperRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceBorder,
    paddingTop: 12,
  },
  countLabel: {
    // Em telas estreitas o rótulo quebra em duas linhas; o contador nunca encolhe.
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  readOnlyCount: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.primary,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceBorder,
    paddingHorizontal: 16,
    paddingTop: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 8,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
    gap: 6,
  },
  progressText: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  buttonsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  reRecordBtn: {
    flex: 0.4,
  },
  submitBtn: {
    flex: 0.6,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    flex: 1,
    width: '100%',
    padding: 16,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
  },
  modalTitle: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
    flex: 1,
    marginRight: 12,
  },
  modalCloseBtn: {
    padding: 6,
  },
  modalImage: {
    flex: 1,
    width: '100%',
  },
});
