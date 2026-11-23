import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
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
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { api } from '../../../services/api';
import { useAuth } from '../../../context/AuthContext';
import { Header } from '../../../components/Header';
import { Input } from '../../../components/Input';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { confirmAction, showMessage } from '../../../utils/confirm';
import { colors, typography } from '../../../constants/theme';

export default function ProductDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { store } = useAuth();

  const {
    data: product,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['manager_product', id],
    queryFn: () => api.getProduct(id!),
    enabled: Boolean(id),
  });

  const [name, setName] = useState('');
  const [variant, setVariant] = useState('');
  const [barcode, setBarcode] = useState('');
  const [minStock, setMinStock] = useState('');
  const [existingPhotos, setExistingPhotos] = useState<string[]>([]);
  const [newPhotoUris, setNewPhotoUris] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState(false);

  useEffect(() => {
    if (product) {
      setName(product.name || '');
      setVariant(product.variant || '');
      setBarcode(product.barcode || '');
      setMinStock(product.min_stock !== null && product.min_stock !== undefined ? String(product.min_stock) : '');
      setExistingPhotos(Array.isArray(product.photos) ? product.photos : []);
      setNewPhotoUris([]);
    }
  }, [product]);

  const totalPhotosCount = existingPhotos.length + newPhotoUris.length;

  const handlePickFromGallery = async () => {
    if (totalPhotosCount >= 4) {
      showMessage('Limite atingido', 'Você pode adicionar no máximo 4 fotos por produto.');
      return;
    }

    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        showMessage('Permissão necessária', 'Permita o acesso à galeria de fotos.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: 4 - totalPhotosCount,
        quality: 0.9,
      });

      if (!result.canceled && result.assets) {
        const uris = result.assets.map((a) => a.uri);
        setNewPhotoUris((prev) => [...prev, ...uris].slice(0, 4 - existingPhotos.length));
      }
    } catch (e: any) {
      showMessage('Erro ao selecionar fotos', e.message);
    }
  };

  const handleTakePhoto = async () => {
    if (totalPhotosCount >= 4) {
      showMessage('Limite atingido', 'Você pode adicionar no máximo 4 fotos por produto.');
      return;
    }

    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        showMessage('Permissão necessária', 'Permita o acesso à câmera para fotografar a embalagem.');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({ quality: 0.9 });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        setNewPhotoUris((prev) => [...prev, result.assets[0].uri].slice(0, 4 - existingPhotos.length));
      }
    } catch (e: any) {
      showMessage('Erro ao abrir câmera', e.message);
    }
  };

  const handleRemoveExistingPhoto = (index: number) => {
    setExistingPhotos((prev) => prev.filter((_, i) => i !== index));
  };

  const handleRemoveNewPhoto = (index: number) => {
    setNewPhotoUris((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    if (!name.trim()) {
      showMessage('Atenção', 'Informe o nome do produto.');
      return;
    }

    setSaving(true);
    try {
      if (!store) throw new Error('Sessão expirada. Entre novamente.');
      const parsedMin = minStock.trim() ? Number.parseInt(minStock.trim(), 10) : null;
      if (parsedMin !== null && (!Number.isFinite(parsedMin) || parsedMin < 0)) {
        throw new Error('Estoque mínimo deve ser um número inteiro não negativo.');
      }

      // Se adicionou fotos novas
      await api.updateProduct(store.id, id!, {
        name: name.trim(),
        variant: variant.trim(),
        barcode: barcode.trim(),
        min_stock: parsedMin,
        photoUris: newPhotoUris.length > 0 ? newPhotoUris : undefined,
      });

      queryClient.invalidateQueries({ queryKey: ['manager_products'] });
      queryClient.invalidateQueries({ queryKey: ['manager_product', id] });
      queryClient.invalidateQueries({ queryKey: ['manager_dashboard'] });

      showMessage('Sucesso', 'Produto atualizado com sucesso!', () => router.back());
    } catch (err: any) {
      showMessage('Erro ao atualizar produto', err.message || 'Falha ao salvar alterações.');
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = () => {
    confirmAction(
      'Remover Produto',
      `Deseja realmente arquivar o produto "${name}"? Ele sairá do catálogo de contagens ativas, mas o histórico passado será preservado.`,
      async () => {
        setArchiving(true);
        try {
          await api.archiveProduct(id!);
          queryClient.invalidateQueries({ queryKey: ['manager_products'] });
          queryClient.invalidateQueries({ queryKey: ['manager_dashboard'] });
          router.back();
        } catch (err: any) {
          showMessage('Erro ao arquivar', err.message || 'Falha ao arquivar produto.');
        } finally {
          setArchiving(false);
        }
      },
      { confirmText: 'Arquivar', destructive: true }
    );
  };

  if (isLoading || !product) {
    return (
      <SafeAreaView style={styles.container}>
        <Header title="Detalhes do Produto" showBack />
        <View style={styles.loadingCenter}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  const isPendingPhotos = existingPhotos.length === 0 && newPhotoUris.length === 0;

  return (
    <SafeAreaView style={styles.container}>
      <Header
        title="Detalhes do Produto"
        showBack
        rightAction={
          <TouchableOpacity style={styles.archiveHeaderBtn} onPress={handleArchive} disabled={archiving}>
            <Ionicons name="trash-outline" size={20} color={colors.danger} />
          </TouchableOpacity>
        }
      />

      <ScrollView contentContainerStyle={styles.content}>
        {/* Pending Photos Warning */}
        {isPendingPhotos && (
          <Card style={styles.pendingCard}>
            <View style={styles.pendingCardHeader}>
              <Ionicons name="warning-outline" size={22} color={colors.warningText} />
              <Text style={styles.pendingCardTitle}>Fotos da Embalagem Pendentes</Text>
            </View>
            <Text style={styles.pendingCardText}>
              Este produto foi cadastrado sem fotos. Tire fotos nítidas da embalagem para que a IA
              possa identificá-lo e contá-lo nas gravações de vídeo.
            </Text>
          </Card>
        )}

        {/* Photos Grid */}
        <Text style={styles.sectionHeading}>Fotos de Referência ({totalPhotosCount}/4)</Text>
        <Text style={styles.sectionSubtitle}>
          Envie até 4 fotos mostrando a marca, nome e variantes.
        </Text>

        <View style={styles.photosGrid}>
          {/* Existing Photos */}
          {existingPhotos.map((url, idx) => (
            <View key={`exist-${idx}`} style={styles.photoThumbWrapper}>
              <Image source={{ uri: api.resolveMediaUrl(url) || undefined }} style={styles.photoThumb} contentFit="cover" />
              <TouchableOpacity
                style={styles.removePhotoBtn}
                onPress={() => handleRemoveExistingPhoto(idx)}
              >
                <Ionicons name="close" size={14} color="#FFF" />
              </TouchableOpacity>
            </View>
          ))}

          {/* New Selected Photos */}
          {newPhotoUris.map((uri, idx) => (
            <View key={`new-${idx}`} style={styles.photoThumbWrapper}>
              <Image source={{ uri }} style={styles.photoThumb} contentFit="cover" />
              <View style={styles.newBadge}>
                <Text style={styles.newBadgeText}>Nova</Text>
              </View>
              <TouchableOpacity
                style={styles.removePhotoBtn}
                onPress={() => handleRemoveNewPhoto(idx)}
              >
                <Ionicons name="close" size={14} color="#FFF" />
              </TouchableOpacity>
            </View>
          ))}

          {totalPhotosCount < 4 && (
            <View style={styles.addPhotoButtonsRow}>
              <TouchableOpacity style={styles.addPhotoBox} onPress={handleTakePhoto}>
                <Ionicons name="camera-outline" size={22} color={colors.primary} />
                <Text style={styles.addPhotoText}>Tirar Foto</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.addPhotoBox} onPress={handlePickFromGallery}>
                <Ionicons name="images-outline" size={22} color={colors.primary} />
                <Text style={styles.addPhotoText}>Galeria</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Form Fields */}
        <Card style={styles.card}>
          <Input
            label="Nome do Produto *"
            value={name}
            onChangeText={setName}
            leftIcon={<Ionicons name="cube-outline" size={20} color={colors.textMuted} />}
          />

          <Input
            label="Variante / Gramatura"
            placeholder="Ex: 90g, Barra, Tradicional"
            value={variant}
            onChangeText={setVariant}
            leftIcon={<Ionicons name="pricetag-outline" size={20} color={colors.textMuted} />}
          />

          <Input
            label="Código de Barras / EAN"
            placeholder="Ex: 7891234567890"
            keyboardType="number-pad"
            value={barcode}
            onChangeText={setBarcode}
            leftIcon={<Ionicons name="barcode-outline" size={20} color={colors.textMuted} />}
          />

          <Input
            label="Estoque Mínimo de Alerta"
            placeholder="Ex: 10"
            keyboardType="number-pad"
            value={minStock}
            onChangeText={setMinStock}
            hint="Alerta no painel se a contagem cair abaixo deste valor."
            leftIcon={<Ionicons name="warning-outline" size={20} color={colors.textMuted} />}
          />
        </Card>

        {/* Current Stock Summary */}
        <Card style={styles.stockCard}>
          <Text style={styles.stockCardTitle}>Situação Atual de Estoque</Text>
          <View style={styles.stockCardRow}>
            <View style={styles.stockCol}>
              <Text style={styles.stockLabel}>Última Contagem</Text>
              <Text style={styles.stockVal}>
                {product.stock !== null && product.stock !== undefined
                  ? `${product.stock} un.`
                  : 'Não contado'}
              </Text>
            </View>
            <View style={styles.stockCol}>
              <Text style={styles.stockLabel}>Status</Text>
              <Text
                style={[
                  styles.stockStatus,
                  product.low_stock ? { color: colors.danger } : { color: colors.success },
                ]}
              >
                {product.low_stock ? 'Estoque Baixo' : 'Normal'}
              </Text>
            </View>
          </View>
        </Card>

        <Button
          title="Salvar Alterações"
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
    padding: 16,
    paddingBottom: 40,
  },
  loadingCenter: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  archiveHeaderBtn: {
    padding: 6,
  },
  pendingCard: {
    padding: 14,
    backgroundColor: colors.warningBg,
    borderColor: '#FDE68A',
    borderWidth: 1,
    marginBottom: 16,
  },
  pendingCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  pendingCardTitle: {
    ...typography.h3,
    fontSize: 14,
    color: colors.warningText,
  },
  pendingCardText: {
    ...typography.caption,
    fontSize: 12,
    color: colors.warningText,
    lineHeight: 17,
  },
  sectionHeading: {
    ...typography.h3,
    fontSize: 15,
  },
  sectionSubtitle: {
    ...typography.caption,
    marginTop: 2,
    marginBottom: 12,
  },
  photosGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 18,
  },
  photoThumbWrapper: {
    position: 'relative',
  },
  photoThumb: {
    width: 76,
    height: 76,
    borderRadius: 10,
  },
  newBadge: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    backgroundColor: colors.primary,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  newBadgeText: {
    color: '#FFF',
    fontSize: 9,
    fontWeight: '700',
  },
  removePhotoBtn: {
    position: 'absolute',
    top: -5,
    right: -5,
    backgroundColor: colors.danger,
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addPhotoButtonsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  addPhotoBox: {
    width: 76,
    height: 76,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.surfaceBorderStrong,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  addPhotoText: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.primary,
    marginTop: 4,
  },
  card: {
    padding: 16,
    marginBottom: 16,
  },
  stockCard: {
    padding: 14,
    marginBottom: 20,
    backgroundColor: colors.surfaceSubtle,
  },
  stockCardTitle: {
    ...typography.caption,
    fontWeight: '700',
    color: colors.textSecondary,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  stockCardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  stockCol: {
    flex: 1,
  },
  stockLabel: {
    ...typography.caption,
    color: colors.textMuted,
  },
  stockVal: {
    ...typography.h3,
    fontSize: 16,
    marginTop: 2,
    color: colors.textPrimary,
  },
  stockStatus: {
    ...typography.h3,
    fontSize: 15,
    marginTop: 2,
    fontWeight: '700',
  },
  saveBtn: {
    marginTop: 4,
  },
});
