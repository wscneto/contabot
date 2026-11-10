import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import { api } from '../../../services/api';
import { Header } from '../../../components/Header';
import { Badge } from '../../../components/Badge';
import { Card } from '../../../components/Card';
import { Button } from '../../../components/Button';
import { Input } from '../../../components/Input';
import { colors, typography } from '../../../constants/theme';

export default function ManagerTaskDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [approving, setApproving] = useState(false);
  const [recounting, setRecounting] = useState(false);
  const [recountModal, setRecountModal] = useState(false);
  const [recountNote, setRecountNote] = useState('');
  const [selectedFrame, setSelectedFrame] = useState<{ url: string; title: string } | null>(null);

  const { data: task, isLoading, refetch } = useQuery({
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

  const isSubmitted = task.status === 'submitted';
  const isApproved = task.status === 'approved';

  const handleApprove = async () => {
    Alert.alert(
      'Aprovar Contagem',
      'Ao aprovar, as quantidades conferidas serão gravadas no estoque oficial da loja.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Aprovar e Gravar',
          onPress: async () => {
            setApproving(true);
            try {
              await api.approveTask(id);
              queryClient.invalidateQueries({ queryKey: ['manager_tasks'] });
              queryClient.invalidateQueries({ queryKey: ['manager_dashboard'] });
              queryClient.invalidateQueries({ queryKey: ['manager_task_detail', id] });
              Alert.alert('Sucesso', 'Contagem aprovada e estoque atualizado!');
            } catch (err: any) {
              Alert.alert('Erro ao aprovar', err.message || 'Falha na aprovação.');
            } finally {
              setApproving(false);
            }
          },
        },
      ]
    );
  };

  const handleRecount = async () => {
    if (!recountNote.trim()) {
      Alert.alert('Atenção', 'Informe o motivo da recontagem para orientar o funcionário.');
      return;
    }
    setRecounting(true);
    try {
      await api.requestRecount(id, recountNote.trim());
      setRecountModal(false);
      setRecountNote('');
      queryClient.invalidateQueries({ queryKey: ['manager_tasks'] });
      queryClient.invalidateQueries({ queryKey: ['manager_dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['manager_task_detail', id] });
      Alert.alert('Recontagem solicitada', 'A contagem retornou para a lista do funcionário com suas instruções.');
    } catch (err: any) {
      Alert.alert('Erro', err.message || 'Falha ao solicitar recontagem.');
    } finally {
      setRecounting(false);
    }
  };

  const handleDelete = () => {
    Alert.alert('Excluir Contagem', 'Deseja excluir esta contagem agendada?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Excluir',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.deleteTask(id);
            queryClient.invalidateQueries({ queryKey: ['manager_tasks'] });
            queryClient.invalidateQueries({ queryKey: ['manager_dashboard'] });
            router.back();
          } catch (err: any) {
            Alert.alert('Erro ao excluir', err.message || 'Falha ao excluir contagem.');
          }
        },
      },
    ]);
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
                Recontagem ativa: "{task.manager_note}"
              </Text>
            </View>
          )}

          {task.due_date && (
            <Text style={styles.dueDateText}>
              Prazo limite: {task.due_date} {task.overdue ? '(Atrasada)' : ''}
            </Text>
          )}
        </Card>

        {/* Comparison Table Header */}
        <View style={styles.tableHeaderRow}>
          <Text style={styles.tableTitle}>Comparação dos Itens ({task.items?.length || 0})</Text>
        </View>

        {/* Product Items */}
        {task.items?.map((item: any) => {
          const photoUrl = api.resolveMediaUrl(item.photo);
          const evidenceUrl = api.resolveMediaUrl(item.evidence_frame);
          const prev = item.previous;
          const counted = isApproved ? item.final : item.counted;
          const aiQty = item.ai_quantity;

          const diffWithPrev = prev !== null && counted !== null ? counted - prev : null;

          return (
            <Card key={item.product_id} style={styles.itemCard}>
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

                <View style={[styles.gridCell, styles.gridCellHighlight]}>
                  <Text style={styles.gridLabelHighlight}>
                    {isApproved ? 'Aprovado' : 'Conferido'}
                  </Text>
                  <Text style={styles.gridValueHighlight}>
                    {counted !== null ? counted : '—'}
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
              title="Aprovar e Gravar Estoque"
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
  dueDateText: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceBorder,
    paddingTop: 8,
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
  tableHeaderRow: {
    marginBottom: 12,
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
