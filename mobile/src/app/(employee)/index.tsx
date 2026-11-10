import React, { useState } from 'react';
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { confirmAction } from '../../utils/confirm';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import { Badge } from '../../components/Badge';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { colors, typography } from '../../constants/theme';

export default function EmployeeHomeScreen() {
  const router = useRouter();
  const { user, store, logout } = useAuth();

  const [activeTab, setActiveTab] = useState<'pending' | 'completed'>('pending');

  const { data: tasks = [], isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['employee_tasks'],
    queryFn: () => api.listTasks('mine'),
  });

  const handleLogout = () => {
    confirmAction(
      'Sair da Conta',
      'Deseja realmente sair da sua sessão?',
      async () => {
        await logout();
        router.replace('/(auth)/login');
      },
      { confirmText: 'Sair', destructive: true },
    );
  };

  const filteredTasks = tasks.filter((t: any) => {
    if (activeTab === 'pending') {
      return t.status !== 'approved';
    }
    return t.status === 'approved';
  });

  const renderTaskItem = ({ item }: { item: any }) => {
    const isRecount = Boolean(item.recount_requested);

    return (
      <Card
        style={[styles.taskCard, isRecount && styles.recountCard]}
        onPress={() => router.push(`/(employee)/task/${item.id}`)}
      >
        {isRecount && (
          <View style={styles.recountBanner}>
            <Ionicons name="alert-circle" size={16} color={colors.warningText} />
            <Text style={styles.recountBannerText}>
              Recontagem Solicitada pelo Gerente
            </Text>
          </View>
        )}

        {isRecount && item.manager_note ? (
          <View style={styles.noteBox}>
            <Text style={styles.noteText}>"{item.manager_note}"</Text>
          </View>
        ) : null}

        <View style={styles.cardHeader}>
          <View style={styles.areaInfo}>
            <Text style={styles.areaName}>{item.area_name}</Text>
            <Text style={styles.itemCount}>
              {item.item_count} {item.item_count === 1 ? 'produto esperado' : 'produtos esperados'}
            </Text>
          </View>
          <Badge variant={item.status} />
        </View>

        {item.due_date && (
          <View style={styles.metaRow}>
            <Ionicons
              name="calendar-outline"
              size={14}
              color={item.overdue ? colors.danger : colors.textMuted}
            />
            <Text
              style={[
                styles.metaText,
                item.overdue && { color: colors.danger, fontWeight: '700' },
              ]}
            >
              Prazo: {item.due_date} {item.overdue ? '(Atrasada)' : ''}
            </Text>
          </View>
        )}

        <View style={styles.cardFooter}>
          <View style={styles.ctaRow}>
            <Text style={styles.ctaText}>
              {item.status === 'open'
                ? 'Iniciar Contagem'
                : item.status === 'analyzing'
                ? 'Aguardando Análise IA…'
                : item.status === 'review'
                ? 'Conferir Números'
                : 'Ver Detalhes'}
            </Text>
            <Ionicons name="arrow-forward" size={16} color={colors.primary} />
          </View>
        </View>
      </Card>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Top Header */}
      <View style={styles.header}>
        <View style={styles.userCol}>
          <Text style={styles.greeting}>Olá, {user?.name}</Text>
          <Text style={styles.storeName}>
            <Ionicons name="storefront-outline" size={13} color={colors.textSecondary} />{' '}
            {store?.name}
          </Text>
        </View>

        <TouchableOpacity onPress={handleLogout} style={styles.logoutBtn} accessibilityLabel="Sair">
          <Ionicons name="log-out-outline" size={22} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          onPress={() => setActiveTab('pending')}
          style={[styles.tabItem, activeTab === 'pending' && styles.tabItemActive]}
        >
          <Text style={[styles.tabLabel, activeTab === 'pending' && styles.tabLabelActive]}>
            Para Fazer
          </Text>
          {tasks.filter((t: any) => t.status !== 'approved').length > 0 && (
            <View style={styles.countBadge}>
              <Text style={styles.countBadgeText}>
                {tasks.filter((t: any) => t.status !== 'approved').length}
              </Text>
            </View>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => setActiveTab('completed')}
          style={[styles.tabItem, activeTab === 'completed' && styles.tabItemActive]}
        >
          <Text style={[styles.tabLabel, activeTab === 'completed' && styles.tabLabelActive]}>
            Concluídas
          </Text>
        </TouchableOpacity>
      </View>

      {/* Task List */}
      <FlatList
        data={filteredTasks}
        keyExtractor={(item) => item.id}
        renderItem={renderTaskItem}
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
        ListEmptyComponent={
          !isLoading ? (
            <View style={styles.emptyContainer}>
              <View style={styles.emptyIconCircle}>
                <Ionicons
                  name={activeTab === 'pending' ? 'checkmark-done-circle-outline' : 'folder-open-outline'}
                  size={48}
                  color={colors.primary}
                />
              </View>
              <Text style={styles.emptyTitle}>
                {activeTab === 'pending'
                  ? 'Nenhuma contagem pendente!'
                  : 'Nenhuma contagem finalizada ainda'}
              </Text>
              <Text style={styles.emptySubtitle}>
                {activeTab === 'pending'
                  ? 'Tudo conferido por enquanto. Novas contagens atribuídas a você aparecerão aqui.'
                  : 'As contagens que forem aprovadas pelo gerente serão arquivadas aqui.'}
              </Text>
            </View>
          ) : undefined
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceBorder,
  },
  userCol: {
    flex: 1,
  },
  greeting: {
    ...typography.h2,
    fontSize: 20,
  },
  storeName: {
    ...typography.caption,
    marginTop: 2,
    color: colors.textSecondary,
  },
  logoutBtn: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: colors.surfaceSubtle,
  },
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 4,
    gap: 8,
  },
  tabItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: colors.surfaceSubtle,
  },
  tabItemActive: {
    backgroundColor: colors.primary,
  },
  tabLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  tabLabelActive: {
    color: colors.textInverse,
  },
  countBadge: {
    marginLeft: 6,
    backgroundColor: colors.surface,
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  countBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.primary,
  },
  listContent: {
    padding: 20,
    flexGrow: 1,
  },
  taskCard: {
    padding: 18,
    marginBottom: 14,
  },
  recountCard: {
    borderColor: colors.warning,
    borderWidth: 1.5,
  },
  recountBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.warningBg,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 10,
  },
  recountBannerText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.warningText,
    marginLeft: 6,
  },
  noteBox: {
    backgroundColor: colors.surfaceSubtle,
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
    borderLeftWidth: 3,
    borderLeftColor: colors.warning,
  },
  noteText: {
    fontSize: 13,
    color: colors.textPrimary,
    fontStyle: 'italic',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  areaInfo: {
    flex: 1,
    marginRight: 10,
  },
  areaName: {
    ...typography.h3,
    fontSize: 18,
  },
  itemCount: {
    ...typography.caption,
    marginTop: 2,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  metaText: {
    fontSize: 13,
    color: colors.textMuted,
    marginLeft: 6,
  },
  cardFooter: {
    borderTopWidth: 1,
    borderTopColor: colors.surfaceBorder,
    paddingTop: 12,
  },
  ctaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  ctaText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.primary,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    paddingHorizontal: 20,
  },
  emptyIconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    ...typography.h2,
    fontSize: 18,
    textAlign: 'center',
    marginBottom: 6,
  },
  emptySubtitle: {
    ...typography.body,
    textAlign: 'center',
    color: colors.textMuted,
  },
});
