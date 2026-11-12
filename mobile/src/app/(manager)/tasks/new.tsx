import React, { useState } from 'react';
import {
  Alert,
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
import { Header } from '../../../components/Header';
import { Input } from '../../../components/Input';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { colors, typography } from '../../../constants/theme';

export default function NewTaskScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { store } = useAuth();
  const params = useLocalSearchParams<{ preselectAreaId?: string }>();

  const todayStr = new Date().toISOString().split('T')[0];

  const [selectedAreaId, setSelectedAreaId] = useState<string>(params.preselectAreaId || '');
  const [assigneeId, setAssigneeId] = useState<string>('');
  const [dueDate, setDueDate] = useState<string>(todayStr);
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
      Alert.alert('Erro ao carregar instrução', error.message);
      return;
    }
    if (note.trim() && note !== defaultNote) {
      Alert.alert('Substituir instruções?', 'O texto atual será substituído pela orientação padrão de filmagem.', [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Substituir', onPress: () => setNote(defaultNote) },
      ]);
      return;
    }
    setNote(defaultNote);
  };

  const handleCreate = async () => {
    if (!selectedAreaId) {
      Alert.alert('Atenção', 'Selecione uma área para contar.');
      return;
    }

    setCreating(true);
    try {
      await api.createTasks({
        area_ids: [selectedAreaId],
        assignee_id: assigneeId || null,
        due_date: dueDate || null,
        note: note.trim(),
      });

      queryClient.invalidateQueries({ queryKey: ['manager_tasks'] });
      queryClient.invalidateQueries({ queryKey: ['manager_dashboard'] });
      router.back();
    } catch (err: any) {
      Alert.alert('Erro ao criar contagem', err.message || 'Falha ao agendar contagem.');
    } finally {
      setCreating(false);
    }
  };

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
        <Text style={styles.sectionLabel}>2. Atribuir a um Funcionário (Opcional)</Text>
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
            .filter((m: any) => m.role === 'employee' && m.active)
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
                      {member.name}
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
          <Input
            label="Data de Vencimento (AAAA-MM-DD)"
            value={dueDate}
            onChangeText={setDueDate}
            placeholder="Ex: 2026-11-10"
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
  submitBtn: {
    marginTop: 10,
  },
});
