import React from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../../context/AuthContext';
import { api } from '../../../services/api';
import { Card } from '../../../components/Card';
import { Badge } from '../../../components/Badge';
import { Button } from '../../../components/Button';
import { colors, typography } from '../../../constants/theme';

export default function ManagerDashboardScreen() {
  const router = useRouter();
  const { user, store } = useAuth();

  const { data: dash, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['manager_dashboard'],
    queryFn: () => api.getDashboard(),
  });

  if (isLoading && !dash) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingCenter}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  const counts = dash?.counts || { to_approve: 0, in_progress: 0, open: 0, overdue: 0 };
  const toApproveList = dash?.to_approve || [];
  const lowStockList = dash?.low_stock || [];
  const staleAreasList = dash?.stale_areas || [];

  return (
    <SafeAreaView style={styles.container}>
      {/* Top Bar */}
      <View style={styles.topBar}>
        <View>
          <Text style={styles.greeting}>Olá, {user?.name}</Text>
          <Text style={styles.storeName}>
            <Ionicons name="storefront" size={13} color={colors.primary} /> {store?.name}
          </Text>
        </View>

        <TouchableOpacity
          onPress={() => router.push('/(manager)/tasks/new')}
          style={styles.newCountBtn}
        >
          <Ionicons name="add" size={18} color="#FFF" />
          <Text style={styles.newCountBtnText}>Nova Contagem</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => {
              void refetch();
            }}
            colors={[colors.primary]}
          />
        }
      >
        {/* KPI Cards Grid */}
        <View style={styles.kpiGrid}>
          <TouchableOpacity
            style={[styles.kpiCard, counts.to_approve > 0 && styles.kpiCardPurple]}
            onPress={() => router.push('/(manager)/tasks')}
          >
            <View style={styles.kpiHeader}>
              <Text style={styles.kpiNumber}>{counts.to_approve}</Text>
              <Ionicons
                name="checkmark-circle-outline"
                size={22}
                color={counts.to_approve > 0 ? colors.purpleText : colors.textMuted}
              />
            </View>
            <Text style={styles.kpiLabel}>Para Aprovar</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.kpiCard}
            onPress={() => router.push('/(manager)/tasks')}
          >
            <View style={styles.kpiHeader}>
              <Text style={styles.kpiNumber}>{counts.in_progress}</Text>
              <Ionicons name="sync-outline" size={22} color={colors.infoText} />
            </View>
            <Text style={styles.kpiLabel}>Em Andamento</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.kpiCard}
            onPress={() => router.push('/(manager)/tasks')}
          >
            <View style={styles.kpiHeader}>
              <Text style={styles.kpiNumber}>{counts.open}</Text>
              <Ionicons name="time-outline" size={22} color={colors.textSecondary} />
            </View>
            <Text style={styles.kpiLabel}>Abertas</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.kpiCard, counts.overdue > 0 && styles.kpiCardDanger]}
            onPress={() => router.push('/(manager)/tasks')}
          >
            <View style={styles.kpiHeader}>
              <Text style={[styles.kpiNumber, counts.overdue > 0 && { color: colors.dangerText }]}>
                {counts.overdue}
              </Text>
              <Ionicons
                name="alert-circle-outline"
                size={22}
                color={counts.overdue > 0 ? colors.dangerText : colors.textMuted}
              />
            </View>
            <Text style={styles.kpiLabel}>Atrasadas</Text>
          </TouchableOpacity>
        </View>

        {/* Section: Awaiting Approval */}
        {toApproveList.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Aguardando Sua Aprovação</Text>
              <TouchableOpacity onPress={() => router.push('/(manager)/tasks')}>
                <Text style={styles.sectionLink}>Ver todas</Text>
              </TouchableOpacity>
            </View>

            {toApproveList.map((item: any) => (
              <Card
                key={item.id}
                style={styles.approvalCard}
                onPress={() => router.push(`/(manager)/tasks/${item.id}`)}
              >
                <View style={styles.approvalTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.approvalArea}>{item.area_name}</Text>
                    <Text style={styles.approvalMeta}>
                      Enviada por <Text style={styles.bold}>{item.submitted_by?.name || 'Funcionário'}</Text>
                    </Text>
                  </View>
                  <Badge variant="submitted" />
                </View>

                <View style={styles.approvalBottom}>
                  <Text style={styles.itemCountText}>
                    {item.item_count} produtos conferidos
                  </Text>
                  <View style={styles.reviewLinkRow}>
                    <Text style={styles.reviewLinkText}>Revisar e Aprovar</Text>
                    <Ionicons name="arrow-forward" size={14} color={colors.primary} />
                  </View>
                </View>
              </Card>
            ))}
          </View>
        )}

        {/* Section: Low Stock Alerts */}
        {lowStockList.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Alertas de Estoque Baixo</Text>
              <TouchableOpacity onPress={() => router.push('/(manager)/products')}>
                <Text style={styles.sectionLink}>Catálogo</Text>
              </TouchableOpacity>
            </View>

            {lowStockList.map((prod: any) => (
              <Card key={prod.id} style={styles.lowStockCard} variant="outlined">
                <View style={styles.lowStockRow}>
                  <View style={styles.lowStockInfo}>
                    <Text style={styles.prodName}>{prod.name}</Text>
                    {prod.variant ? <Text style={styles.prodVariant}>{prod.variant}</Text> : null}
                  </View>
                  <View style={styles.stockBadgeCol}>
                    <Text style={styles.currentStockText}>
                      {prod.stock !== null ? prod.stock : 0} un.
                    </Text>
                    <Text style={styles.minStockText}>Mín: {prod.min_stock}</Text>
                  </View>
                </View>
              </Card>
            ))}
          </View>
        )}

        {/* Section: Stale Areas */}
        {staleAreasList.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Áreas sem Contagem Recente</Text>
              <TouchableOpacity onPress={() => router.push('/(manager)/areas')}>
                <Text style={styles.sectionLink}>Ver áreas</Text>
              </TouchableOpacity>
            </View>

            {staleAreasList.map((area: any) => (
              <Card key={area.id} style={styles.staleCard} variant="outlined">
                <View style={styles.staleRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.staleAreaName}>{area.name}</Text>
                    <Text style={styles.staleAreaMeta}>
                      {area.last_counted_at
                        ? `Última: ${new Date(area.last_counted_at).toLocaleDateString('pt-BR')}`
                        : 'Nunca contada'}
                    </Text>
                  </View>
                  <Button
                    title="Mandar Contar"
                    size="sm"
                    onPress={() =>
                      router.push({
                        pathname: '/(manager)/tasks/new',
                        params: { preselectAreaId: area.id },
                      })
                    }
                  />
                </View>
              </Card>
            ))}
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
  loadingCenter: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceBorder,
  },
  greeting: {
    ...typography.h2,
    fontSize: 20,
  },
  storeName: {
    ...typography.caption,
    marginTop: 2,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  newCountBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    gap: 4,
  },
  newCountBtnText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '700',
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 24,
  },
  kpiCard: {
    flex: 1,
    minWidth: '46%',
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  kpiCardPurple: {
    backgroundColor: colors.purpleBg,
    borderColor: '#E9D5FF',
  },
  kpiCardDanger: {
    backgroundColor: colors.dangerBg,
    borderColor: '#FECACA',
  },
  kpiHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  kpiNumber: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  kpiLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    ...typography.h3,
    fontSize: 17,
  },
  sectionLink: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
  },
  approvalCard: {
    padding: 16,
    marginBottom: 10,
    borderLeftWidth: 4,
    borderLeftColor: colors.purple,
  },
  approvalTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  approvalArea: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  approvalMeta: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  bold: {
    fontWeight: '700',
  },
  approvalBottom: {
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
  reviewLinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  reviewLinkText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.primary,
  },
  lowStockCard: {
    padding: 14,
    marginBottom: 8,
  },
  lowStockRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  lowStockInfo: {
    flex: 1,
    marginRight: 12,
  },
  prodName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  prodVariant: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 1,
  },
  stockBadgeCol: {
    alignItems: 'flex-end',
  },
  currentStockText: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.danger,
  },
  minStockText: {
    fontSize: 11,
    color: colors.textMuted,
  },
  staleCard: {
    padding: 14,
    marginBottom: 8,
  },
  staleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  staleAreaName: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  staleAreaMeta: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
});
