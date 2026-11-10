import React, { useState } from 'react';
import {
  Alert,
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../../services/api';
import { Header } from '../../../components/Header';
import { Input } from '../../../components/Input';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { colors, typography } from '../../../constants/theme';

export default function NewAreaScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [saving, setSaving] = useState(false);

  // Fetch all products
  const { data: products = [] } = useQuery({
    queryKey: ['manager_products'],
    queryFn: () => api.listProducts(),
  });

  const toggleProduct = (productId: string) => {
    setSelectedProductIds((prev) =>
      prev.includes(productId) ? prev.filter((id) => id !== productId) : [...prev, productId]
    );
  };

  const filteredProducts = products.filter((p: any) =>
    p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
    (p.variant && p.variant.toLowerCase().includes(productSearch.toLowerCase()))
  );

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert('Atenção', 'Informe o nome da área.');
      return;
    }
    if (selectedProductIds.length === 0) {
      Alert.alert(
        'Atenção',
        'Selecione ao menos um produto que fica exposto nesta área para que a IA saiba o que procurar.'
      );
      return;
    }

    setSaving(true);
    try {
      await api.createArea({
        name: name.trim(),
        description: description.trim(),
        product_ids: selectedProductIds,
      });

      queryClient.invalidateQueries({ queryKey: ['manager_areas'] });
      queryClient.invalidateQueries({ queryKey: ['manager_dashboard'] });
      router.back();
    } catch (err: any) {
      Alert.alert('Erro ao criar área', err.message || 'Falha ao salvar área.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <Header title="Cadastrar Área da Loja" showBack />

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

        {/* Product selection checklist */}
        <Text style={styles.sectionHeading}>
          Produtos desta Área ({selectedProductIds.length} selecionados) *
        </Text>
        <Text style={styles.sectionSubtitle}>
          Marque quais produtos ficam expostos nesta prateleira. Quando o funcionário filmar, a IA buscará apenas estes SKUs.
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
            <Text style={styles.emptyText}>Nenhum produto cadastrado no catálogo.</Text>
          ) : (
            filteredProducts.map((prod: any) => {
              const isChecked = selectedProductIds.includes(prod.id);
              return (
                <TouchableOpacity
                  key={prod.id}
                  style={[styles.prodCheckRow, isChecked && styles.prodCheckRowActive]}
                  onPress={() => toggleProduct(prod.id)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.prodName, isChecked && styles.prodNameActive]}>
                      {prod.name}
                    </Text>
                    {prod.variant ? (
                      <Text style={styles.prodVariant}>{prod.variant}</Text>
                    ) : null}
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
          title="Salvar Área"
          onPress={handleSave}
          loading={saving}
          size="lg"
          style={styles.saveBtn}
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
});
