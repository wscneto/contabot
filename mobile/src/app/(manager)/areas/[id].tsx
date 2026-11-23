import React, { useState } from 'react';
import {
  ActivityIndicator,
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
import { api } from '../../../services/api';
import { Header } from '../../../components/Header';
import { Input } from '../../../components/Input';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { confirmAction, showMessage } from '../../../utils/confirm';
import { colors, typography } from '../../../constants/theme';

interface AreaData {
  id: string;
  name: string;
  description?: string;
  product_ids?: string[];
  last_counted_at?: string | null;
}

interface AreaEditFormProps {
  area: AreaData;
  products: any[];
  onSaved: () => void;
  onDeletePress: () => void;
  deleting: boolean;
}

function AreaEditForm({ area, products, onSaved, onDeletePress, deleting }: AreaEditFormProps) {
  const [name, setName] = useState(area.name || '');
  const [description, setDescription] = useState(area.description || '');
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>(
    Array.isArray(area.product_ids) ? area.product_ids : [],
  );
  const [productSearch, setProductSearch] = useState('');
  const [saving, setSaving] = useState(false);

  const toggleProduct = (productId: string) => {
    setSelectedProductIds((prev) =>
      prev.includes(productId) ? prev.filter((item) => item !== productId) : [...prev, productId],
    );
  };

  const filteredProducts = products.filter(
    (p: any) =>
      p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
      (p.variant && p.variant.toLowerCase().includes(productSearch.toLowerCase())),
  );

  const handleSave = async () => {
    if (!name.trim()) {
      showMessage('Atenção', 'Informe o nome da área.');
      return;
    }
    if (selectedProductIds.length === 0) {
      showMessage(
        'Atenção',
        'Selecione ao menos um produto que fica exposto nesta área para que a IA saiba o que procurar.',
      );
      return;
    }

    setSaving(true);
    try {
      await api.updateArea(area.id, {
        name: name.trim(),
        description: description.trim(),
        product_ids: selectedProductIds,
      });
      onSaved();
    } catch (err: any) {
      showMessage('Erro ao atualizar área', err.message || 'Falha ao salvar alterações.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Card style={styles.card}>
        <Input
          label="Nome da Área *"
          placeholder="Ex: Gôndola 4 – Biscoitos e Salgadinhos"
          value={name}
          onChangeText={setName}
          leftIcon={<Ionicons name="map-outline" size={20} color={colors.textMuted} />}
        />

        <Input
          label="Descrição / Localização (Opcional)"
          placeholder="Ex: Prateleiras do meio, corredor central"
          value={description}
          onChangeText={setDescription}
          leftIcon={<Ionicons name="location-outline" size={20} color={colors.textMuted} />}
        />
      </Card>

      <Text style={styles.sectionHeading}>
        Produtos desta Área ({selectedProductIds.length} selecionados) *
      </Text>
      <Text style={styles.sectionSubtitle}>
        Marque quais produtos ficam expostos nesta prateleira. Quando alguém filmar, a IA buscará apenas estes SKUs.
      </Text>

      <Input
        placeholder="Filtrar produtos…"
        value={productSearch}
        onChangeText={setProductSearch}
        leftIcon={<Ionicons name="search-outline" size={18} color={colors.textMuted} />}
        containerStyle={{ marginBottom: 12 }}
      />

      <Card style={styles.productsCard}>
        {filteredProducts.length === 0 ? (
          <Text style={styles.emptyText}>Nenhum produto encontrado no catálogo.</Text>
        ) : (
          filteredProducts.map((prod: any) => {
            const isChecked = selectedProductIds.includes(prod.id);
            return (
              <TouchableOpacity
                key={prod.id}
                style={[styles.prodCheckRow, isChecked && styles.prodCheckRowActive]}
                onPress={() => toggleProduct(prod.id)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: isChecked }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.prodName, isChecked && styles.prodNameActive]}>
                    {prod.name}
                  </Text>
                  {prod.variant ? <Text style={styles.prodVariant}>{prod.variant}</Text> : null}
                </View>

                <Ionicons
                  name={isChecked ? 'checkbox' : 'square-outline'}
                  size={22}
                  color={isChecked ? colors.primary : colors.textMuted}
                />
              </TouchableOpacity>
            );
          })
        )}
      </Card>

      <Button
        title="Salvar Alterações"
        onPress={handleSave}
        loading={saving}
        disabled={deleting}
        size="lg"
        style={styles.saveBtn}
      />

      <Button
        title="Excluir Área"
        onPress={onDeletePress}
        loading={deleting}
        disabled={saving}
        variant="danger"
        size="md"
        icon={<Ionicons name="trash-outline" size={18} color="#FFF" />}
        style={styles.deleteBtn}
      />
    </ScrollView>
  );
}

export default function EditAreaScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [deleting, setDeleting] = useState(false);

  const { data: area, isLoading } = useQuery<AreaData>({
    queryKey: ['manager_area', id],
    queryFn: () => api.getArea(id!),
    enabled: Boolean(id),
  });

  const { data: products = [] } = useQuery({
    queryKey: ['manager_products'],
    queryFn: () => api.listProducts(),
  });

  const invalidateAreaQueries = () => {
    void queryClient.invalidateQueries({ queryKey: ['manager_areas'] });
    void queryClient.invalidateQueries({ queryKey: ['manager_area', id] });
    void queryClient.invalidateQueries({ queryKey: ['manager_dashboard'] });
    void queryClient.invalidateQueries({ queryKey: ['manager_tasks'] });
  };

  const handleSaved = () => {
    invalidateAreaQueries();
    showMessage('Sucesso', 'Área atualizada com sucesso!', () => router.back());
  };

  const handleDelete = () => {
    if (!area) return;
    confirmAction(
      'Excluir Área',
      `Deseja realmente excluir a área "${area.name}"? As contagens e registros de estoque vinculados a esta área também serão removidos.`,
      async () => {
        setDeleting(true);
        try {
          await api.deleteArea(area.id);
          invalidateAreaQueries();
          router.back();
        } catch (err: any) {
          showMessage('Erro ao excluir área', err.message || 'Falha ao excluir área.');
        } finally {
          setDeleting(false);
        }
      },
      { confirmText: 'Excluir', destructive: true },
    );
  };

  if (isLoading || !area) {
    return (
      <SafeAreaView style={styles.container}>
        <Header title="Editar Área" showBack />
        <View style={styles.loadingCenter}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <Header
        title="Editar Área"
        showBack
        rightAction={
          <TouchableOpacity
            style={styles.headerDeleteBtn}
            onPress={handleDelete}
            disabled={deleting}
            accessibilityLabel="Excluir área"
          >
            <Ionicons name="trash-outline" size={20} color={colors.danger} />
          </TouchableOpacity>
        }
      />

      <AreaEditForm
        key={`${area.id}-${(area.product_ids ?? []).join(',')}`}
        area={area}
        products={products}
        onSaved={handleSaved}
        onDeletePress={handleDelete}
        deleting={deleting}
      />
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
  headerDeleteBtn: {
    padding: 6,
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  card: {
    padding: 16,
    marginBottom: 20,
  },
  sectionHeading: {
    ...typography.h3,
    fontSize: 16,
  },
  sectionSubtitle: {
    ...typography.caption,
    marginTop: 4,
    marginBottom: 12,
    lineHeight: 18,
  },
  productsCard: {
    padding: 8,
    marginBottom: 20,
  },
  prodCheckRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceBorder,
  },
  prodCheckRowActive: {
    backgroundColor: colors.primaryLight,
  },
  prodName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  prodNameActive: {
    color: colors.primaryDark,
    fontWeight: '700',
  },
  prodVariant: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 1,
  },
  emptyText: {
    ...typography.body,
    textAlign: 'center',
    paddingVertical: 16,
    color: colors.textMuted,
  },
  saveBtn: {
    marginTop: 6,
  },
  deleteBtn: {
    marginTop: 12,
  },
});
