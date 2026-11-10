import React, { useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { confirmAction } from '../../../utils/confirm';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../../context/AuthContext';
import { api } from '../../../services/api';
import { Header } from '../../../components/Header';
import { Card } from '../../../components/Card';
import { Button } from '../../../components/Button';
import { Input } from '../../../components/Input';
import { QRCodeModal } from '../../../components/QRCodeModal';
import { colors, typography } from '../../../constants/theme';

export default function ManagerTeamScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, store, logout } = useAuth();

  const [addModal, setAddModal] = useState(false);
  const [newMemberName, setNewMemberName] = useState('');
  const [addingMember, setAddingMember] = useState(false);

  const [activeQrMember, setActiveQrMember] = useState<{ name: string; code: string } | null>(null);

  const { data: team = [], isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['manager_team'],
    queryFn: () => api.listTeam(),
  });

  const handleAddMember = async () => {
    if (!newMemberName.trim()) {
      Alert.alert('Atenção', 'Informe o nome do funcionário.');
      return;
    }

    setAddingMember(true);
    try {
      const res = await api.createEmployee(newMemberName.trim());
      setAddModal(false);
      setNewMemberName('');
      queryClient.invalidateQueries({ queryKey: ['manager_team'] });

      // Open QR code right away for the new member
      setActiveQrMember({
        name: res.user.name,
        code: res.access_code,
      });
    } catch (err: any) {
      Alert.alert('Erro ao cadastrar funcionário', err.message);
    } finally {
      setAddingMember(false);
    }
  };

  const handleRegenerateCode = (memberId: string, memberName: string) => {
    Alert.alert(
      'Gerar Novo Código',
      `Deseja gerar um novo código para ${memberName}? O código anterior deixará de funcionar.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Gerar Novo',
          onPress: async () => {
            try {
              const res = await api.regenerateAccessCode(memberId);
              queryClient.invalidateQueries({ queryKey: ['manager_team'] });
              setActiveQrMember({
                name: memberName,
                code: res.access_code,
              });
            } catch (err: any) {
              Alert.alert('Erro', err.message);
            }
          },
        },
      ]
    );
  };

  const handleDeactivate = (memberId: string, memberName: string) => {
    Alert.alert(
      'Desativar Funcionário',
      `Deseja desativar o acesso de ${memberName}? O funcionário não conseguirá mais entrar no aplicativo.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Desativar',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.deactivateMember(memberId);
              queryClient.invalidateQueries({ queryKey: ['manager_team'] });
            } catch (err: any) {
              Alert.alert('Erro', err.message);
            }
          },
        },
      ]
    );
  };

  const handleLogout = () => {
    confirmAction(
      'Sair da Conta',
      'Deseja realmente sair da sua sessão de gerente?',
      async () => {
        await logout();
        router.replace('/(auth)/login');
      },
      { confirmText: 'Sair', destructive: true },
    );
  };

  const renderItem = ({ item }: { item: any }) => {
    const isManager = item.role === 'manager';

    return (
      <Card style={styles.card}>
        <View style={styles.cardRow}>
          <View style={styles.avatar}>
            <Ionicons
              name={isManager ? 'shield-checkmark' : 'person'}
              size={22}
              color={isManager ? colors.primary : colors.textSecondary}
            />
          </View>

          <View style={styles.infoCol}>
            <View style={styles.nameRow}>
              <Text style={styles.memberName}>{item.name}</Text>
              {isManager && (
                <View style={styles.managerPill}>
                  <Text style={styles.managerPillText}>Gerente</Text>
                </View>
              )}
            </View>

            {item.email ? (
              <Text style={styles.emailText}>{item.email}</Text>
            ) : (
              <Text style={styles.openTasksText}>
                {item.open_tasks} contagens atribuídas
              </Text>
            )}
          </View>

          {!isManager && item.active && (
            <View style={styles.actionsCol}>
              <TouchableOpacity
                style={styles.actionIconBtn}
                onPress={() => handleRegenerateCode(item.id, item.name)}
                accessibilityLabel="Gerar novo código"
              >
                <Ionicons name="key-outline" size={20} color={colors.primary} />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.actionIconBtn}
                onPress={() => handleDeactivate(item.id, item.name)}
                accessibilityLabel="Desativar funcionário"
              >
                <Ionicons name="trash-outline" size={20} color={colors.danger} />
              </TouchableOpacity>
            </View>
          )}
        </View>
      </Card>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <Header
        title="Equipe e Loja"
        rightAction={
          <TouchableOpacity
            style={styles.headerBtn}
            onPress={() => setAddModal(true)}
          >
            <Ionicons name="person-add" size={22} color={colors.primary} />
          </TouchableOpacity>
        }
      />

      <FlatList
        data={team}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => {
              void refetch();
            }}
            colors={[colors.primary]}
          />
        }
        ListHeaderComponent={
          <View style={styles.listHeader}>
            {/* Store Information Card */}
            <Card style={styles.storeCard}>
              <Text style={styles.storeTitle}>{store?.name}</Text>
              <Text style={styles.storeMeta}>
                Gerente: <Text style={styles.bold}>{user?.name}</Text>
              </Text>
            </Card>

            <View style={styles.teamHeaderRow}>
              <Text style={styles.teamTitle}>Membros da Equipe ({team.length})</Text>
              <Button
                title="+ Funcionário"
                size="sm"
                onPress={() => setAddModal(true)}
              />
            </View>
          </View>
        }
        ListFooterComponent={
          <View style={styles.footerSection}>
            <Button
              title="Sair da Conta de Gerente"
              onPress={handleLogout}
              variant="outline"
              style={styles.logoutBtn}
            />
          </View>
        }
      />

      {/* Add Member Modal */}
      <Modal visible={addModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Adicionar Funcionário</Text>
            <Text style={styles.modalSubtitle}>
              O funcionário receberá um código de 8 dígitos e QR code para acessar o app sem precisar de e-mail.
            </Text>

            <Input
              label="Nome do Funcionário *"
              placeholder="Ex: Ana Balcão"
              value={newMemberName}
              onChangeText={setNewMemberName}
              leftIcon={<Ionicons name="person-outline" size={20} color={colors.textMuted} />}
            />

            <View style={styles.modalBtns}>
              <Button
                title="Cancelar"
                onPress={() => setAddModal(false)}
                variant="outline"
                style={{ flex: 1 }}
              />
              <Button
                title="Cadastrar"
                onPress={handleAddMember}
                loading={addingMember}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        </View>
      </Modal>

      {/* QR Code Modal for Invitation */}
      {activeQrMember && (
        <QRCodeModal
          visible={Boolean(activeQrMember)}
          onClose={() => setActiveQrMember(null)}
          memberName={activeQrMember.name}
          accessCode={activeQrMember.code}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  headerBtn: {
    padding: 6,
  },
  listContent: {
    padding: 16,
    paddingBottom: 40,
  },
  listHeader: {
    marginBottom: 16,
  },
  storeCard: {
    padding: 16,
    marginBottom: 20,
    backgroundColor: colors.surfaceSubtle,
  },
  storeTitle: {
    ...typography.h2,
    fontSize: 20,
    marginBottom: 4,
  },
  storeMeta: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 10,
  },
  bold: {
    fontWeight: '700',
  },
  teamHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  teamTitle: {
    ...typography.h3,
    fontSize: 17,
  },
  card: {
    padding: 14,
    marginBottom: 10,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surfaceSubtle,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  infoCol: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  memberName: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  managerPill: {
    backgroundColor: colors.primaryLight,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  managerPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.primaryDark,
  },
  emailText: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  openTasksText: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  actionsCol: {
    flexDirection: 'row',
    gap: 4,
  },
  actionIconBtn: {
    padding: 8,
  },
  footerSection: {
    marginTop: 24,
  },
  logoutBtn: {
    borderColor: colors.danger,
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
    padding: 24,
    width: '100%',
    maxWidth: 380,
  },
  modalTitle: {
    ...typography.h2,
    fontSize: 20,
    marginBottom: 4,
  },
  modalSubtitle: {
    ...typography.body,
    fontSize: 13,
    marginBottom: 16,
    lineHeight: 18,
  },
  modalBtns: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
});
