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
import { Button } from '../../../components/Button';
import { colors, typography } from '../../../constants/theme';

export default function ManagerProductsScreen() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [filterLowStock, setFilterLowStock] = useState(false);
  const [filterPendingPhotos, setFilterPendingPhotos] = useState(false);

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
    const isPending = !p.photos || p.photos.length === 0;
    const matchesPending = filterPendingPhotos ? isPending : true;
    return matchesSearch && matchesLow && matchesPending;
  });

  const pendingPhotosCount = products.filter((p: any) => !p.photos || p.photos.length === 0).length;

  const renderItem = ({ item }: { item: any }) => {
    const photoUrl = api.resolveMediaUrl(item.photos?.[0]);
    const isPendingPhotos = !item.photos || item.photos.length === 0;

    return (
      <Card
        style={[styles.card, isPendingPhotos && styles.cardPending]}
        onPress={() => router.push(`/(manager)/products/${item.id}`)}
      >
        <View style={styles.cardRow}>
          {photoUrl ? (
            <Image source={{ uri: photoUrl }} style={styles.thumb} contentFit="cover" />
          ) : (
            <View style={[styles.thumbEmpty, isPendingPhotos && styles.thumbEmptyWarning]}>
              <Ionicons
                name={isPendingPhotos ? 'camera-outline' : 'cube-outline'}
                size={24}
                color={isPendingPhotos ? colors.warningText : colors.textMuted}
              />
            </View>
          )}

          <View style={styles.infoCol}>
            <View style={styles.nameRow}>
              <Text style={styles.name}>{item.name}</Text>
            </View>

            {item.variant ? <Text style={styles.variant}>{item.variant}</Text> : null}
            {item.barcode ? (
              <Text style={styles.barcode}>EAN: {item.barcode}</Text>
            ) : null}

            {isPendingPhotos ? (
              <View style={styles.pendingNoticeRow}>
                <Ionicons name="alert-circle-outline" size={13} color={colors.warningText} />
                <Text style={styles.pendingNoticeText}>Foto pendente · Toque para fotografar</Text>
              </View>
            ) : (
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
            )}
          </View>

          <View style={styles.badgesCol}>
            {isPendingPhotos && (
              <View style={styles.pendingBadge}>
                <Ionicons name="camera-outline" size={12} color={colors.warningText} />
                <Text style={styles.pendingBadgeText}>Sem foto</Text>
              </View>
            )}

            {item.low_stock && (
              <View style={styles.lowStockBadge}>
                <Text style={styles.lowStockBadgeText}>Baixo</Text>
              </View>
            )}

            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} style={{ marginTop: 4 }} />
          </View>
        </View>
      </Card>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <Header
        title="Catálogo de Produtos"
        rightAction={
          <View style={styles.headerActionsRow}>
            <TouchableOpacity
              style={styles.headerBtn}
              onPress={() => router.push('/(manager)/products/import')}
              accessibilityLabel="Importar por planilha"
            >
              <Ionicons name="cloud-upload-outline" size={22} color={colors.primary} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.headerBtn}
              onPress={() => router.push('/(manager)/products/new')}
              accessibilityLabel="Cadastrar produto manualmente"
            >
              <Ionicons name="add" size={26} color={colors.primary} />
            </TouchableOpacity>
          </View>
        }
      />

      <View style={styles.searchBarContainer}>
        <Input
          placeholder="Buscar por nome, variante ou código…"
          value={search}
          onChangeText={setSearch}
          leftIcon={<Ionicons name="search-outline" size={18} color={colors.textMuted} />}
          containerStyle={{ marginBottom: 10 }}
        />

        <View style={styles.filterChipsRow}>
          <TouchableOpacity
            style={[styles.filterChip, filterLowStock && styles.filterChipActive]}
            onPress={() => setFilterLowStock(!filterLowStock)}
          >
            <Ionicons
              name="warning-outline"
              size={13}
              color={filterLowStock ? '#FFF' : colors.warningText}
            />
            <Text style={[styles.filterChipText, filterLowStock && styles.filterChipTextActive]}>
              Estoque baixo
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.filterChip,
              filterPendingPhotos && styles.filterChipPendingActive,
              pendingPhotosCount > 0 && !filterPendingPhotos && styles.filterChipPendingAlert,
            ]}
            onPress={() => setFilterPendingPhotos(!filterPendingPhotos)}
          >
            <Ionicons
              name="camera-outline"
              size={13}
              color={filterPendingPhotos ? '#FFF' : colors.warningText}
            />
            <Text
              style={[
                styles.filterChipText,
                filterPendingPhotos && styles.filterChipTextActive,
                pendingPhotosCount > 0 && !filterPendingPhotos && { color: colors.warningText },
              ]}
            >
              Fotos pendentes {pendingPhotosCount > 0 ? `(${pendingPhotosCount})` : ''}
            </Text>
          </TouchableOpacity>
        </View>
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
                Cadastre um produto manualmente ou importe uma planilha com seus itens.
              </Text>

              <View style={styles.emptyActionsRow}>
                <Button
                  title="Importar Planilha (.csv/.xlsx)"
                  size="sm"
                  variant="outline"
                  onPress={() => router.push('/(manager)/products/import')}
                />
                <Button
                  title="Cadastrar Manualmente"
                  size="sm"
                  onPress={() => router.push('/(manager)/products/new')}
                />
              </View>
            </View>
          ) : undefined
        }
      />

      {/* Botão Redondo no canto inferior direito para o Modo Fotos em Lote */}
      {filterPendingPhotos && pendingPhotosCount > 0 && (
        <TouchableOpacity
          style={styles.batchPhotosFab}
          onPress={() => router.push('/(manager)/products/batch-photos')}
          activeOpacity={0.85}
          accessibilityLabel="Modo fotos em lote"
        >
          <Ionicons name="camera" size={26} color="#FFF" />
          <View style={styles.batchBadge}>
            <Text style={styles.batchBadgeText}>{pendingPhotosCount}</Text>
          </View>
        </TouchableOpacity>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  batchPhotosFab: {
    position: 'absolute',
    bottom: 24,
    right: 20,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.28,
    shadowRadius: 4.5,
    zIndex: 999,
  },
  batchBadge: {
    position: 'absolute',
    top: -3,
    right: -3,
    backgroundColor: colors.warning,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFF',
  },
  batchBadgeText: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: '800',
  },
  headerActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
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
  filterChipsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceSubtle,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 14,
    gap: 4,
    borderWidth: 1,
    borderColor: colors.surfaceBorderStrong,
  },
  filterChipActive: {
    backgroundColor: colors.warning,
    borderColor: colors.warning,
  },
  filterChipPendingAlert: {
    backgroundColor: colors.warningBg,
    borderColor: '#FDE68A',
  },
  filterChipPendingActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
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
  cardPending: {
    borderColor: '#FDE68A',
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
  thumbEmptyWarning: {
    backgroundColor: colors.warningBg,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  infoCol: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
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
  pendingNoticeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  pendingNoticeText: {
    fontSize: 11,
    color: colors.warningText,
    fontWeight: '600',
  },
  badgesCol: {
    alignItems: 'flex-end',
    gap: 4,
    marginLeft: 8,
  },
  pendingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.warningBg,
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  pendingBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.warningText,
  },
  lowStockBadge: {
    backgroundColor: colors.dangerBg,
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  lowStockBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.dangerText,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 50,
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
    marginBottom: 20,
  },
  emptyActionsRow: {
    flexDirection: 'column',
    gap: 10,
    width: '100%',
    maxWidth: 280,
  },
});
