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
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../../services/api';
import { Header } from '../../../components/Header';
import { Card } from '../../../components/Card';
import { Input } from '../../../components/Input';
import { colors, typography } from '../../../constants/theme';

export default function ManagerProductsScreen() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [filterLowStock, setFilterLowStock] = useState(false);

  const { data: products = [], isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['manager_products'],
    queryFn: () => api.listProducts(),
  });

  const filtered = products.filter((p: any) => {
    const matchesSearch =
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.variant && p.variant.toLowerCase().includes(search.toLowerCase())) ||
      (p.barcode && p.barcode.includes(search));
    const matchesLow = filterLowStock ? p.low_stock : true;
    return matchesSearch && matchesLow;
  });

  const renderItem = ({ item }: { item: any }) => {
    const photoUrl = api.resolveMediaUrl(item.photos?.[0]);

    return (
      <Card style={styles.card}>
        <View style={styles.cardRow}>
          {photoUrl ? (
            <Image source={{ uri: photoUrl }} style={styles.thumb} contentFit="cover" />
          ) : (
            <View style={styles.thumbEmpty}>
              <Ionicons name="cube-outline" size={24} color={colors.textMuted} />
            </View>
          )}

          <View style={styles.infoCol}>
            <Text style={styles.name}>{item.name}</Text>
            {item.variant ? <Text style={styles.variant}>{item.variant}</Text> : null}
            {item.barcode ? (
              <Text style={styles.barcode}>EAN: {item.barcode}</Text>
            ) : null}

            <View style={styles.stockRow}>
              <Text style={styles.stockText}>
                Estoque:{' '}
                <Text style={[styles.bold, item.low_stock && { color: colors.danger }]}>
                  {item.stock !== null ? `${item.stock} un.` : 'Não contado'}
                </Text>
              </Text>
              {item.min_stock !== null && (
                <Text style={styles.minStockText}>· Mín: {item.min_stock}</Text>
              )}
            </View>
          </View>

          {item.low_stock && (
            <View style={styles.lowStockBadge}>
              <Text style={styles.lowStockBadgeText}>Baixo</Text>
            </View>
          )}
        </View>
      </Card>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <Header
        title="Catálogo de Produtos"
        rightAction={
          <TouchableOpacity
            style={styles.headerBtn}
            onPress={() => router.push('/(manager)/products/new')}
          >
            <Ionicons name="add" size={24} color={colors.primary} />
          </TouchableOpacity>
        }
      />

      <View style={styles.searchBarContainer}>
        <Input
          placeholder="Buscar por nome, variante ou código…"
          value={search}
          onChangeText={setSearch}
          leftIcon={<Ionicons name="search-outline" size={18} color={colors.textMuted} />}
          containerStyle={{ marginBottom: 8 }}
        />

        <TouchableOpacity
          style={[styles.filterChip, filterLowStock && styles.filterChipActive]}
          onPress={() => setFilterLowStock(!filterLowStock)}
        >
          <Ionicons
            name="warning-outline"
            size={14}
            color={filterLowStock ? '#FFF' : colors.warningText}
          />
          <Text style={[styles.filterChipText, filterLowStock && styles.filterChipTextActive]}>
            Apenas estoque baixo
          </Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={filtered}
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
              <Ionicons name="cube-outline" size={48} color={colors.textMuted} />
              <Text style={styles.emptyTitle}>Nenhum produto encontrado</Text>
              <Text style={styles.emptySubtitle}>
                Toque no botão "+" acima para cadastrar seu primeiro produto com fotos da embalagem.
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
  searchBarContainer: {
    paddingHorizontal: 16,
    paddingTop: 10,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceBorder,
    paddingBottom: 10,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.warningBg,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 14,
    gap: 4,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  filterChipActive: {
    backgroundColor: colors.warning,
    borderColor: colors.warning,
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.warningText,
  },
  filterChipTextActive: {
    color: '#FFF',
  },
  listContent: {
    padding: 16,
    paddingBottom: 40,
  },
  card: {
    padding: 14,
    marginBottom: 10,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  thumb: {
    width: 56,
    height: 56,
    borderRadius: 8,
    marginRight: 12,
  },
  thumbEmpty: {
    width: 56,
    height: 56,
    borderRadius: 8,
    backgroundColor: colors.surfaceSubtle,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  infoCol: {
    flex: 1,
  },
  name: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  variant: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 1,
  },
  barcode: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },
  stockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  stockText: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  bold: {
    fontWeight: '700',
    color: colors.textPrimary,
  },
  minStockText: {
    fontSize: 12,
    color: colors.textMuted,
    marginLeft: 4,
  },
  lowStockBadge: {
    backgroundColor: colors.dangerBg,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  lowStockBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.dangerText,
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
