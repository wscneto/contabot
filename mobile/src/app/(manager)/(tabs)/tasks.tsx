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
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../../services/api';
import { Header } from '../../../components/Header';
import { Badge } from '../../../components/Badge';
import { Card } from '../../../components/Card';
import { colors, typography } from '../../../constants/theme';

export default function ManagerTasksScreen() {
  const router = useRouter();
  const [filterTab, setFilterTab] = useState<'all' | 'submitted' | 'open' | 'approved'>('all');

  const { data: tasks = [], isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['manager_tasks'],
    queryFn: () => api.listTasks('all'),
  });

  const filteredTasks = tasks.filter((t: any) => {
    if (filterTab === 'all') return true;
    if (filterTab === 'submitted') return t.status === 'submitted';
    if (filterTab === 'open') return t.status === 'open' || t.status === 'analyzing' || t.status === 'review';
    if (filterTab === 'approved') return t.status === 'approved';
    return true;
  });

  const renderItem = ({ item }: { item: any }) => {
    return (
      <Card
        style={[styles.card, item.status === 'submitted' && styles.submittedCard]}
        onPress={() => router.push(`/(manager)/tasks/${item.id}`)}
      >
        <View style={styles.cardHeader}>
          <View style={{ flex: 1, marginRight: 10 }}>
            <Text style={styles.areaName}>{item.area_name}</Text>
            <Text style={styles.assigneeText}>
              Responsável: <Text style={styles.bold}>{item.assignee?.name || 'Não atribuído'}</Text>
            </Text>
          </View>
          <Badge variant={item.status} />
        </View>

        {item.due_date && (
          <View style={styles.dateRow}>
            <Ionicons
              name="calendar-outline"
              size={14}
              color={item.overdue ? colors.danger : colors.textMuted}
            />
            <Text style={[styles.dateText, item.overdue && { color: colors.danger, fontWeight: '700' }]}>
              Prazo: {item.due_date} {item.overdue ? '(Atrasada)' : ''}
            </Text>
          </View>
        )}

        <View style={styles.cardFooter}>
          <Text style={styles.itemCountText}>
            {item.item_count} produtos na área
          </Text>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </View>
      </Card>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <Header
        title="Contagens de Estoque"
        rightAction={
          <TouchableOpacity
            style={styles.headerBtn}
            onPress={() => router.push('/(manager)/tasks/new')}
          >
            <Ionicons name="add" size={24} color={colors.primary} />
          </TouchableOpacity>
        }
      />

      {/* Filter Tabs */}
      <View style={styles.tabContainer}>
        {[
          { key: 'all', label: 'Todas' },
          { key: 'submitted', label: 'Para Aprovar' },
          { key: 'open', label: 'Abertas' },
          { key: 'approved', label: 'Aprovadas' },
        ].map((tab) => (
          <TouchableOpacity
            key={tab.key}
            onPress={() => setFilterTab(tab.key as any)}
            style={[styles.tab, filterTab === tab.key && styles.tabActive]}
          >
            <Text style={[styles.tabText, filterTab === tab.key && styles.tabTextActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={filteredTasks}
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
        ListEmptyComponent={
          !isLoading ? (
            <View style={styles.emptyContainer}>
              <Ionicons name="clipboard-outline" size={48} color={colors.textMuted} />
              <Text style={styles.emptyTitle}>Nenhuma contagem encontrada</Text>
              <Text style={styles.emptySubtitle}>
                Toque no botão "+" acima para iniciar uma nova contagem para sua equipe.
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
  headerBtn: {
    padding: 6,
  },
  tabContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceBorder,
  },
  tab: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: colors.surfaceSubtle,
  },
  tabActive: {
    backgroundColor: colors.primary,
  },
  tabText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  tabTextActive: {
    color: '#FFF',
  },
  listContent: {
    padding: 16,
    paddingBottom: 40,
  },
  card: {
    padding: 16,
    marginBottom: 12,
  },
  submittedCard: {
    borderLeftWidth: 4,
    borderLeftColor: colors.purple,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  areaName: {
    ...typography.h3,
    fontSize: 17,
  },
  assigneeText: {
    ...typography.caption,
    marginTop: 2,
    color: colors.textSecondary,
  },
  bold: {
    fontWeight: '700',
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    gap: 6,
  },
  dateText: {
    fontSize: 12,
    color: colors.textMuted,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.surfaceBorder,
    paddingTop: 10,
  },
  itemCountText: {
    fontSize: 13,
    color: colors.textMuted,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: 20,
  },
  emptyTitle: {
    ...typography.h3,
    marginTop: 16,
    marginBottom: 4,
  },
  emptySubtitle: {
    ...typography.body,
    textAlign: 'center',
    color: colors.textMuted,
  },
});
