import React from 'react';
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
import { Card } from '../../../components/Card';
import { Button } from '../../../components/Button';
import { colors, typography } from '../../../constants/theme';

export default function ManagerAreasScreen() {
  const router = useRouter();

  const { data: areas = [], isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['manager_areas'],
    queryFn: () => api.listAreas(),
  });

  const renderItem = ({ item }: { item: any }) => {
    return (
      <Card style={styles.card}>
        <View style={styles.cardTop}>
          <View style={{ flex: 1, marginRight: 10 }}>
            <Text style={styles.areaName}>{item.name}</Text>
            {item.description ? (
              <Text style={styles.areaDesc}>{item.description}</Text>
            ) : null}
          </View>
          <View style={styles.countBadge}>
            <Text style={styles.countBadgeText}>{item.product_count} produtos</Text>
          </View>
        </View>

        <View style={styles.cardBottom}>
          <Text style={styles.lastCountedText}>
            {item.last_counted_at
              ? `Última contagem: ${new Date(item.last_counted_at).toLocaleDateString('pt-BR')}`
              : 'Nunca contada'}
          </Text>

          <Button
            title="Mandar Contar"
            size="sm"
            onPress={() =>
              router.push({
                pathname: '/(manager)/tasks/new',
                params: { preselectAreaId: item.id },
              })
            }
          />
        </View>
      </Card>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <Header
        title="Áreas da Loja"
        rightAction={
          <TouchableOpacity
            style={styles.headerBtn}
            onPress={() => router.push('/(manager)/areas/new')}
          >
            <Ionicons name="add" size={24} color={colors.primary} />
          </TouchableOpacity>
        }
      />

      <FlatList
        data={areas}
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
              <Ionicons name="map-outline" size={48} color={colors.textMuted} />
              <Text style={styles.emptyTitle}>Nenhuma área cadastrada</Text>
              <Text style={styles.emptySubtitle}>
                Divida sua loja em gôndolas, corredores ou depósitos para facilitar a filmagem pelo celular.
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
  listContent: {
    padding: 16,
    paddingBottom: 40,
  },
  card: {
    padding: 16,
    marginBottom: 12,
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  areaName: {
    ...typography.h3,
    fontSize: 17,
  },
  areaDesc: {
    ...typography.caption,
    marginTop: 2,
    lineHeight: 18,
  },
  countBadge: {
    backgroundColor: colors.surfaceSubtle,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  countBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  cardBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.surfaceBorder,
    paddingTop: 12,
  },
  lastCountedText: {
    fontSize: 12,
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
