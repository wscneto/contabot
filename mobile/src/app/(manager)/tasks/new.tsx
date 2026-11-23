import React, { useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../../context/AuthContext';
import { api } from '../../../services/api';
import { confirmAction, showMessage } from '../../../utils/confirm';
import {
  formatIsoDateToBR,
  getRelativeIsoDate,
  maskBRDateInput,
  parseBRDateToIso,
} from '../../../utils/date';
import { Header } from '../../../components/Header';
import { Input } from '../../../components/Input';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { colors, typography } from '../../../constants/theme';

export default function NewTaskScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { store, user } = useAuth();
  const params = useLocalSearchParams<{ preselectAreaId?: string }>();

  const todayIso = getRelativeIsoDate(0);
  const tomorrowIso = getRelativeIsoDate(1);
  const nextWeekIso = getRelativeIsoDate(7);

  const [selectedAreaId, setSelectedAreaId] = useState<string>(params.preselectAreaId || '');
  const [assigneeId, setAssigneeId] = useState<string>('');
  const [dueDateInput, setDueDateInput] = useState<string>(formatIsoDateToBR(todayIso));
  const [note, setNote] = useState<string>('');
  const [creating, setCreating] = useState(false);

  // Fetch areas
  const { data: areas = [] } = useQuery({
    queryKey: ['manager_areas'],
    queryFn: () => api.listAreas(),
  });

  // Fetch team
  const { data: team = [] } = useQuery({
    queryKey: ['manager_team'],
    queryFn: () => api.listTeam(),
  });

  const handleUseDefaultNote = async () => {
    let defaultNote: string;
    try {
      const settings = await queryClient.fetchQuery({
        queryKey: ['store_settings', store?.id],
        queryFn: () => api.getStoreSettings(),
        staleTime: 0,
      });
      defaultNote = settings.default_counting_instruction;
    } catch (error: any) {
      showMessage('Erro ao carregar instrução', error.message);
      return;
    }
    if (note.trim() && note !== defaultNote) {
      confirmAction(
        'Substituir instruções?',
        'O texto atual será substituído pela orientação padrão de filmagem.',
        () => setNote(defaultNote),
        { confirmText: 'Substituir' },
      );
      return;
    }
    setNote(defaultNote);
  };

  const parsedDueDateIso = parseBRDateToIso(dueDateInput);

  const handleCreate = async () => {
    if (!selectedAreaId) {
      showMessage('Atenção', 'Selecione uma área para contar.');
      return;
    }

    const trimmedDue = dueDateInput.trim();
    if (trimmedDue && !parsedDueDateIso) {
      showMessage('Data inválida', 'Informe uma data válida no formato DD/MM/AAAA ou deixe sem prazo.');
      return;
    }

    setCreating(true);
    try {
      await api.createTasks({
        area_ids: [selectedAreaId],
        assignee_id: assigneeId || null,
        due_date: trimmedDue ? parsedDueDateIso : null,
        note: note.trim(),
      });

      void queryClient.invalidateQueries({ queryKey: ['manager_tasks'] });
      void queryClient.invalidateQueries({ queryKey: ['manager_dashboard'] });
      router.back();
    } catch (err: any) {
      showMessage('Erro ao criar contagem', err.message || 'Falha ao agendar contagem.');
    } finally {
      setCreating(false);
    }
  };

  const quickDateOptions = [
    { key: 'today', label: 'Hoje', value: formatIsoDateToBR(todayIso) },
    { key: 'tomorrow', label: 'Amanhã', value: formatIsoDateToBR(tomorrowIso) },
    { key: 'week', label: '+7 dias', value: formatIsoDateToBR(nextWeekIso) },
    { key: 'none', label: 'Sem prazo', value: '' },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <Header title="Nova Contagem de Estoque" showBack />

      <ScrollView contentContainerStyle={styles.content}>
        {/* Step 1: Area Selection */}
        <Text style={styles.sectionLabel}>1. Selecione a Área da Loja *</Text>
        <Card style={styles.card}>
          {areas.length === 0 ? (
            <Text style={styles.emptyText}>
              Nenhuma área cadastrada. Cadastre uma área antes de iniciar contagens.
            </Text>
          ) : (
            areas.map((area: any) => {
              const isSelected = selectedAreaId === area.id;
              return (
                <TouchableOpacity
                  key={area.id}
                  style={[styles.selectRow, isSelected && styles.selectRowActive]}
                  onPress={() => setSelectedAreaId(area.id)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.selectTitle, isSelected && styles.selectTitleActive]}>
                      {area.name}
                    </Text>
                    <Text style={styles.selectSubtitle}>
                      {area.product_count} produtos cadastrados
                    </Text>
                  </View>
                  <Ionicons
                    name={isSelected ? 'radio-button-on' : 'radio-button-off'}
                    size={22}
                    color={isSelected ? colors.primary : colors.textMuted}
                  />
                </TouchableOpacity>
              );
            })
          )}
        </Card>

        {/* Step 2: Assignee Selection */}
        <Text style={styles.sectionLabel}>2. Quem vai contar (Opcional)</Text>
        <Card style={styles.card}>
          <TouchableOpacity
            style={[styles.selectRow, assigneeId === '' && styles.selectRowActive]}
            onPress={() => setAssigneeId('')}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.selectTitle, assigneeId === '' && styles.selectTitleActive]}>
                Qualquer funcionário (Livre)
              </Text>
              <Text style={styles.selectSubtitle}>Fica disponível para quem estiver na loja contar</Text>
            </View>
            <Ionicons
              name={assigneeId === '' ? 'radio-button-on' : 'radio-button-off'}
              size={22}
              color={assigneeId === '' ? colors.primary : colors.textMuted}
            />
          </TouchableOpacity>

          {team
            // O próprio gerente também pode assumir a contagem.
            .filter((m: any) => m.active && (m.role === 'employee' || m.id === user?.id))
            .map((member: any) => {
              const isSelected = assigneeId === member.id;
              return (
                <TouchableOpacity
                  key={member.id}
                  style={[styles.selectRow, isSelected && styles.selectRowActive]}
                  onPress={() => setAssigneeId(member.id)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.selectTitle, isSelected && styles.selectTitleActive]}>
                      {member.id === user?.id ? `${member.name} (eu)` : member.name}
                    </Text>
                    <Text style={styles.selectSubtitle}>
                      {member.open_tasks} contagens atribuídas
                    </Text>
                  </View>
                  <Ionicons
                    name={isSelected ? 'radio-button-on' : 'radio-button-off'}
                    size={22}
                    color={isSelected ? colors.primary : colors.textMuted}
                  />
                </TouchableOpacity>
              );
            })}
        </Card>

        {/* Step 3: Date & Note */}
        <Text style={styles.sectionLabel}>3. Prazo e Instruções</Text>
        <Card style={styles.card}>
          <Text style={styles.quickDateLabel}>Atalhos de prazo</Text>
          <View style={styles.quickDateRow}>
            {quickDateOptions.map((opt) => {
              const active = dueDateInput.trim() === opt.value;
              return (
                <TouchableOpacity
                  key={opt.key}
                  style={[styles.quickDateChip, active && styles.quickDateChipActive]}
                  onPress={() => setDueDateInput(opt.value)}
                >
                  <Text style={[styles.quickDateText, active && styles.quickDateTextActive]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Input
            label="Data de Vencimento (DD/MM/AAAA)"
            value={dueDateInput}
            onChangeText={(val) => setDueDateInput(maskBRDateInput(val))}
            placeholder="Ex: 23/11/2026"
            keyboardType="number-pad"
            maxLength={10}
            leftIcon={<Ionicons name="calendar-outline" size={20} color={colors.textMuted} />}
          />

          <Input
            label="Instruções para a Filmagem (Opcional)"
            placeholder="Ex: Mostre a prateleira superior e as caixas do fundo com calma."
            value={note}
            onChangeText={setNote}
            multiline
            numberOfLines={3}
            leftIcon={<Ionicons name="chatbox-outline" size={20} color={colors.textMuted} />}
          />
          <Button
            title="Usar instrução padrão"
            onPress={handleUseDefaultNote}
            variant="outline"
            size="sm"
          />
        </Card>

        <Button
          title="Criar e Agendar Contagem"
          onPress={handleCreate}
          loading={creating}
          size="lg"
          style={styles.submitBtn}
        />
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
    padding: 20,
    paddingBottom: 40,
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textSecondary,
    marginBottom: 8,
    marginTop: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  card: {
    padding: 14,
    marginBottom: 20,
  },
  selectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceBorder,
  },
  selectRowActive: {
    backgroundColor: colors.primaryLight,
  },
  selectTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  selectTitleActive: {
    color: colors.primaryDark,
    fontWeight: '700',
  },
  selectSubtitle: {
    ...typography.caption,
    marginTop: 2,
  },
  emptyText: {
    ...typography.body,
    textAlign: 'center',
    paddingVertical: 16,
    color: colors.textMuted,
  },
  quickDateLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 8,
  },
  quickDateRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  quickDateChip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  quickDateChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  quickDateText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  quickDateTextActive: {
    color: '#FFF',
  },
  submitBtn: {
    marginTop: 10,
  },
});
