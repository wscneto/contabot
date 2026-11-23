import React, { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../../context/AuthContext';
import { api } from '../../../services/api';
import { exportApprovedTaskCsv } from '../../../utils/exportCsv';
import { confirmAction, showMessage } from '../../../utils/confirm';
import { formatIsoDateToBR } from '../../../utils/date';
import { Header } from '../../../components/Header';
import { Badge } from '../../../components/Badge';
import { Card } from '../../../components/Card';
import { Button } from '../../../components/Button';
import { ExportCsvButton } from '../../../components/ExportCsvButton';
import { Input } from '../../../components/Input';
import { Stepper } from '../../../components/Stepper';
import { colors, typography } from '../../../constants/theme';

export default function ManagerTaskDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const [approving, setApproving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [recounting, setRecounting] = useState(false);
  const [recountModal, setRecountModal] = useState(false);
  const [recountNote, setRecountNote] = useState('');
  const [selectedFrame, setSelectedFrame] = useState<{ url: string; title: string } | null>(null);
  const [countOverrides, setCountOverrides] = useState<Record<string, number | null>>({});

  const { data: task, isLoading } = useQuery({
    queryKey: ['manager_task_detail', id],
    queryFn: () => api.getTask(id),
    enabled: Boolean(id),
  });

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

  const isManager = user?.role === 'manager';
  const isSubmitted = task.status === 'submitted';
  const isApproved = task.status === 'approved';
  const canCount = ['open', 'analyzing', 'review'].includes(task.status);
  const adjustedCount = Object.keys(countOverrides).length;

  const handleOverrideChange = (
    productId: string,
    originalCount: number | null,
    nextVal: number | null,
  ) => {
    setCountOverrides((prev) => {
      const next = { ...prev };
      if (nextVal === originalCount) {
        delete next[productId];
      } else {
        next[productId] = nextVal;
      }
      return next;
    });
  };

  const handleExportCsv = async () => {
    if (!isManager || !isApproved || exporting) return;
    setExporting(true);
    try {
      await exportApprovedTaskCsv(id);
    } catch (err: any) {
      showMessage('Erro ao exportar CSV', err.message || 'Não foi possível exportar a contagem.');
    } finally {
      setExporting(false);
    }
  };

  const handleApprove = () => {
    const message =
      adjustedCount > 0
        ? `Você ajustou ${adjustedCount} ${adjustedCount === 1 ? 'item' : 'itens'}. Ao aprovar, as quantidades finais serão gravadas no estoque oficial da loja.`
        : 'Ao aprovar, as quantidades conferidas serão gravadas no estoque oficial da loja.';

    confirmAction(
      'Aprovar Contagem',
      message,
      async () => {
        setApproving(true);
        try {
          await api.approveTask(id, adjustedCount > 0 ? countOverrides : undefined);
          setCountOverrides({});
          void queryClient.invalidateQueries({ queryKey: ['manager_tasks'] });
          void queryClient.invalidateQueries({ queryKey: ['manager_dashboard'] });
          void queryClient.invalidateQueries({ queryKey: ['manager_products'] });
          void queryClient.invalidateQueries({ queryKey: ['manager_task_detail', id] });
          showMessage('Sucesso', 'Contagem aprovada e estoque atualizado!');
        } catch (err: any) {
          showMessage('Erro ao aprovar', err.message || 'Falha na aprovação.');
        } finally {
          setApproving(false);
        }
      },
      { confirmText: 'Aprovar e Gravar' },
    );
  };

  const handleRecount = async () => {
    if (!recountNote.trim()) {
      showMessage('Atenção', 'Informe o motivo da recontagem para orientar o funcionário.');
      return;
    }
    setRecounting(true);
    try {
      await api.requestRecount(id, recountNote.trim());
      setRecountModal(false);
      setRecountNote('');
      setCountOverrides({});
      void queryClient.invalidateQueries({ queryKey: ['manager_tasks'] });
      void queryClient.invalidateQueries({ queryKey: ['manager_dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['manager_task_detail', id] });
      showMessage(
        'Recontagem solicitada',
        'A contagem retornou para a lista do funcionário com suas instruções.',
      );
    } catch (err: any) {
      showMessage('Erro', err.message || 'Falha ao solicitar recontagem.');
    } finally {
      setRecounting(false);
    }
  };

  const handleDelete = () => {
    confirmAction(
      'Excluir Contagem',
      'Deseja excluir esta contagem agendada?',
      async () => {
        try {
          await api.deleteTask(id);
          void queryClient.invalidateQueries({ queryKey: ['manager_tasks'] });
          void queryClient.invalidateQueries({ queryKey: ['manager_dashboard'] });
          router.back();
        } catch (err: any) {
          showMessage('Erro ao excluir', err.message || 'Falha ao excluir contagem.');
        }
      },
      { confirmText: 'Excluir', destructive: true },
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <Header
        title={task.area?.name || 'Detalhes da Contagem'}
        showBack
        rightAction={
          !isApproved ? (
            <TouchableOpacity onPress={handleDelete} style={{ padding: 4 }}>
              <Ionicons name="trash-outline" size={22} color={colors.danger} />
            </TouchableOpacity>
          ) : undefined
        }
      />

      <ScrollView contentContainerStyle={styles.content}>
        {/* Status Card */}
        <Card style={styles.summaryCard}>
          <View style={styles.summaryTop}>
            <View style={{ flex: 1 }}>
              <Text style={styles.summaryArea}>{task.area?.name}</Text>
              <Text style={styles.summaryAssignee}>
                Responsável: <Text style={styles.bold}>{task.assignee?.name || 'Não atribuído'}</Text>
              </Text>
              {task.submitted_by && (
                <Text style={styles.summaryMeta}>
                  Filmado e conferido por <Text style={styles.bold}>{task.submitted_by.name}</Text>
                </Text>
              )}
            </View>
            <Badge variant={task.status} />
          </View>

          {task.recount_requested && (
            <View style={styles.recountBox}>
              <Ionicons name="alert-circle" size={16} color={colors.warningText} />
              <Text style={styles.recountText}>
                Recontagem ativa: &quot;{task.manager_note}&quot;
              </Text>
            </View>
          )}

          {(task.due_date || (isApproved && isManager)) && (
            <View style={styles.summaryFooter}>
              {task.due_date ? (
                <Text style={styles.dueDateText}>
                  Prazo limite: {formatIsoDateToBR(task.due_date)} {task.overdue ? '(Atrasada)' : ''}
                </Text>
              ) : (
                <View />
              )}
              {isApproved && isManager && (
                <ExportCsvButton
                  loading={exporting}
                  onPress={() => {
                    void handleExportCsv();
                  }}
                />
              )}
            </View>
          )}
        </Card>

        {/* O gerente também pode filmar ou conferir, pelo mesmo fluxo da equipe. */}
        {canCount && (
          <Button
            title={
              task.status === 'open'
                ? 'Contar Agora'
                : task.status === 'analyzing'
                ? 'Acompanhar Análise'
                : 'Conferir Números'
            }
            onPress={() => router.push(`/task/${id}`)}
            size="lg"
            icon={<Ionicons name="videocam-outline" size={20} color="#FFF" />}
            style={styles.countBtn}
          />
        )}

        {/* Comparison Table Header */}
        <View style={styles.tableHeaderRow}>
          <Text style={styles.tableTitle}>Comparação dos Itens ({task.items?.length || 0})</Text>
          {isSubmitted && adjustedCount > 0 && (
            <TouchableOpacity onPress={() => setCountOverrides({})}>
              <Text style={styles.resetOverridesLink}>Desfazer ajustes ({adjustedCount})</Text>
            </TouchableOpacity>
          )}
        </View>

        {isSubmitted && (
          <View style={styles.editTipBox}>
            <Ionicons name="create-outline" size={16} color={colors.primaryDark} />
            <Text style={styles.editTipText}>
              Você pode ajustar a quantidade final de qualquer item abaixo antes de aprovar, sem precisar pedir recontagem.
            </Text>
          </View>
        )}

        {/* Product Items */}
        {task.items?.map((item: any) => {
          const photoUrl = api.resolveMediaUrl(item.photo);
          const evidenceUrl = api.resolveMediaUrl(item.evidence_frame);
          const prev = item.previous;
          const hasOverride = Object.prototype.hasOwnProperty.call(countOverrides, item.product_id);
          const finalValue = isApproved
            ? item.final
            : isSubmitted && hasOverride
            ? countOverrides[item.product_id]
            : item.counted;
          const aiQty = item.ai_quantity;
          const isAdjusted = isSubmitted && hasOverride;
          const wasAdjustedOnApproval =
            isApproved && item.counted !== null && item.final !== null && item.final !== item.counted;

          const diffWithPrev = prev !== null && finalValue !== null ? finalValue - prev : null;

          return (
            <Card key={item.product_id} style={[styles.itemCard, isAdjusted && styles.itemCardAdjusted]}>
              <View style={styles.itemTopRow}>
                {photoUrl ? (
                  <Image source={{ uri: photoUrl }} style={styles.itemThumb} contentFit="cover" />
                ) : (
                  <View style={styles.itemThumbEmpty}>
                    <Ionicons name="cube-outline" size={20} color={colors.textMuted} />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemName}>{item.name}</Text>
                  {item.variant ? <Text style={styles.itemVariant}>{item.variant}</Text> : null}
                  <View style={styles.badgeLine}>
                    <Badge variant={item.ai_status} size="sm" />
                    {isAdjusted && (
                      <View style={styles.adjustedPill}>
                        <Text style={styles.adjustedPillText}>Ajustado</Text>
                      </View>
                    )}
                    {evidenceUrl && (
                      <TouchableOpacity
                        onPress={() => setSelectedFrame({ url: evidenceUrl, title: item.name })}
                        style={styles.frameLink}
                      >
                        <Ionicons name="image-outline" size={13} color={colors.primary} />
                        <Text style={styles.frameLinkText}>Frame IA</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              </View>

              {/* Numbers Comparison Grid */}
              <View style={styles.gridContainer}>
                <View style={styles.gridCell}>
                  <Text style={styles.gridLabel}>Anterior</Text>
                  <Text style={styles.gridValue}>{prev !== null ? prev : '—'}</Text>
                </View>

                <View style={styles.gridCell}>
                  <Text style={styles.gridLabel}>Sugestão IA</Text>
                  <Text style={styles.gridValue}>{aiQty !== null ? aiQty : '—'}</Text>
                </View>

                <View style={[styles.gridCell, !isSubmitted && styles.gridCellHighlight]}>
                  <Text style={!isSubmitted ? styles.gridLabelHighlight : styles.gridLabel}>
                    {isApproved ? 'Aprovado' : 'Conferido'}
                  </Text>
                  <Text style={!isSubmitted ? styles.gridValueHighlight : styles.gridValue}>
                    {isApproved
                      ? item.final !== null
                        ? item.final
                        : '—'
                      : item.counted !== null
                      ? item.counted
                      : '—'}
                  </Text>
                </View>

                {diffWithPrev !== null && (
                  <View style={styles.gridCell}>
                    <Text style={styles.gridLabel}>Variação</Text>
                    <Text
                      style={[
                        styles.gridValue,
                        diffWithPrev > 0 && { color: colors.success },
                        diffWithPrev < 0 && { color: colors.danger },
                      ]}
                    >
                      {diffWithPrev > 0 ? `+${diffWithPrev}` : diffWithPrev}
                    </Text>
                  </View>
                )}
              </View>

              {isSubmitted && (
                <View style={styles.managerEditRow}>
                  <Text style={styles.managerEditLabel}>Quantidade final:</Text>
                  <Stepper
                    value={finalValue ?? null}
                    onChange={(val) => handleOverrideChange(item.product_id, item.counted ?? null, val)}
                  />
                </View>
              )}

              {wasAdjustedOnApproval && (
                <Text style={styles.adjustedAuditText}>
                  Ajustado na aprovação (equipe contou {item.counted}).
                </Text>
              )}

              {item.ai_note ? (
                <Text style={styles.aiNoteText}>Nota IA: {item.ai_note}</Text>
              ) : null}
            </Card>
          );
        })}

        {/* Manager Action Bar (When status is submitted) */}
        {isSubmitted && (
          <View style={styles.actionButtonsCol}>
            <Button
              title={
                adjustedCount > 0
                  ? `Aprovar com ${adjustedCount} ${adjustedCount === 1 ? 'Ajuste' : 'Ajustes'}`
                  : 'Aprovar e Gravar Estoque'
              }
              onPress={handleApprove}
              loading={approving}
              size="lg"
              icon={<Ionicons name="checkmark-circle-outline" size={20} color="#FFF" />}
              style={styles.approveBtn}
            />

            <Button
              title="Pedir Recontagem com Observação"
              onPress={() => setRecountModal(true)}
              variant="outline"
              icon={<Ionicons name="arrow-undo-outline" size={18} color={colors.textPrimary} />}
              style={styles.recountActionBtn}
            />
          </View>
        )}

        {/* Timeline Events */}
        {task.events && task.events.length > 0 && (
          <View style={styles.eventsSection}>
            <Text style={styles.eventsHeading}>Histórico de Eventos</Text>
            {task.events.map((ev: any, idx: number) => (
              <View key={idx} style={styles.eventRow}>
                <View style={styles.eventDot} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.eventText}>{ev.text}</Text>
                  <Text style={styles.eventDate}>
                    {new Date(ev.at).toLocaleString('pt-BR')}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Recount Modal */}
      <Modal visible={recountModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Solicitar Recontagem</Text>
            <Text style={styles.modalSubtitle}>
              Escreva orientações específicas para o funcionário saber exatamente o que rever.
            </Text>

            <Input
              label="Instrução para a recontagem *"
              placeholder="Ex: Por favor confira a prateleira de baixo, parecia ter caixas encobertas."
              value={recountNote}
              onChangeText={setRecountNote}
              multiline
              numberOfLines={3}
            />

            <View style={styles.modalButtonsRow}>
              <Button
                title="Cancelar"
                onPress={() => setRecountModal(false)}
                variant="outline"
                style={{ flex: 1 }}
              />
              <Button
                title="Enviar Pedido"
                onPress={handleRecount}
                loading={recounting}
                variant="danger"
                style={{ flex: 1 }}
              />
            </View>
          </View>
        </View>
      </Modal>

      {/* Frame Preview Modal */}
      <Modal visible={Boolean(selectedFrame)} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <SafeAreaView style={styles.frameModalContent}>
            <View style={styles.frameModalHeader}>
              <Text style={styles.frameModalTitle}>{selectedFrame?.title}</Text>
              <TouchableOpacity onPress={() => setSelectedFrame(null)}>
                <Ionicons name="close" size={24} color="#FFF" />
              </TouchableOpacity>
            </View>
            {selectedFrame?.url && (
              <Image
                source={{ uri: selectedFrame.url }}
                style={styles.frameModalImage}
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
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  summaryCard: {
    padding: 18,
    marginBottom: 20,
  },
  summaryTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 6,
  },
  summaryArea: {
    ...typography.h2,
    fontSize: 20,
  },
  summaryAssignee: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 4,
  },
  summaryMeta: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  bold: {
    fontWeight: '700',
  },
  summaryFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceBorder,
    paddingTop: 10,
  },
  dueDateText: {
    fontSize: 12,
    color: colors.textMuted,
    flex: 1,
  },
  recountBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.warningBg,
    borderRadius: 8,
    padding: 8,
    marginTop: 8,
    gap: 6,
  },
  recountText: {
    fontSize: 12,
    color: colors.warningText,
    fontWeight: '600',
    flex: 1,
  },
  countBtn: {
    marginBottom: 20,
  },
  tableHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  resetOverridesLink: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primary,
  },
  editTipBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.primaryLight,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  editTipText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    color: colors.primaryDark,
    fontWeight: '500',
  },
  tableTitle: {
    ...typography.h3,
    fontSize: 16,
    color: colors.textSecondary,
  },
  itemCard: {
    padding: 14,
    marginBottom: 12,
  },
  itemCardAdjusted: {
    borderColor: colors.primary,
    borderWidth: 1.5,
  },
  adjustedPill: {
    backgroundColor: colors.primaryLight,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 9999,
  },
  adjustedPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.primaryDark,
  },
  managerEditRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceBorder,
    paddingTop: 10,
    marginTop: 6,
  },
  managerEditLabel: {
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  adjustedAuditText: {
    fontSize: 11,
    color: colors.primaryDark,
    fontWeight: '600',
    marginTop: 4,
  },
  itemTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  itemThumb: {
    width: 48,
    height: 48,
    borderRadius: 8,
    marginRight: 12,
  },
  itemThumbEmpty: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: colors.surfaceSubtle,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  itemName: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  itemVariant: {
    fontSize: 12,
    color: colors.textMuted,
  },
  badgeLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  frameLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  frameLinkText: {
    fontSize: 12,
    color: colors.primary,
    fontWeight: '600',
  },
  gridContainer: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceSubtle,
    borderRadius: 10,
    padding: 8,
    justifyContent: 'space-around',
    marginBottom: 6,
  },
  gridCell: {
    alignItems: 'center',
    flex: 1,
  },
  gridCellHighlight: {
    backgroundColor: colors.primaryLight,
    borderRadius: 6,
    paddingVertical: 2,
  },
  gridLabel: {
    fontSize: 11,
    color: colors.textMuted,
    marginBottom: 2,
  },
  gridLabelHighlight: {
    fontSize: 11,
    color: colors.primaryDark,
    fontWeight: '700',
    marginBottom: 2,
  },
  gridValue: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  gridValueHighlight: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.primaryDark,
  },
  aiNoteText: {
    fontSize: 11,
    color: colors.textMuted,
    fontStyle: 'italic',
    marginTop: 4,
  },
  actionButtonsCol: {
    marginVertical: 16,
    gap: 10,
  },
  approveBtn: {
    backgroundColor: colors.success,
    borderColor: colors.success,
  },
  recountActionBtn: {},
  eventsSection: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceBorder,
  },
  eventsHeading: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textSecondary,
    marginBottom: 12,
  },
  eventRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  eventDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
    marginTop: 5,
    marginRight: 10,
  },
  eventText: {
    fontSize: 13,
    color: colors.textPrimary,
    fontWeight: '500',
  },
  eventDate: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 1,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: 20,
    width: '100%',
    maxWidth: 380,
  },
  modalTitle: {
    ...typography.h2,
    fontSize: 18,
    marginBottom: 4,
  },
  modalSubtitle: {
    ...typography.body,
    fontSize: 13,
    marginBottom: 16,
  },
  modalButtonsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  frameModalContent: {
    flex: 1,
    width: '100%',
    padding: 16,
  },
  frameModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
  },
  frameModalTitle: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
  },
  frameModalImage: {
    flex: 1,
    width: '100%',
  },
});
