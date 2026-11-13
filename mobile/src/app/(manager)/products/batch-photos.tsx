import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { api } from '../../../services/api';
import { useAuth } from '../../../context/AuthContext';
import { confirmAction, showMessage } from '../../../utils/confirm';
import { colors, typography } from '../../../constants/theme';

export default function BatchPhotosScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { store } = useAuth();

  const { data: products = [], isLoading } = useQuery({
    queryKey: ['manager_products'],
    queryFn: () => api.listProducts(),
  });

  // Lista dos produtos pendentes em ordem alfabética por nome
  const initialPendingList = useMemo(() => {
    return products
      .filter((p: any) => !p.photos || p.photos.length === 0)
      .sort((a: any, b: any) => (a.name || '').localeCompare(b.name || '', 'pt-BR'));
  }, [products]);

  // Lista local para remover produtos que foram salvos nesta sessão
  const [pendingList, setPendingList] = useState<any[] | null>(null);
  const currentPending = pendingList ?? initialPendingList;

  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentPhotos, setCurrentPhotos] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const currentProduct = currentPending[currentIndex];
  const isFirst = currentIndex === 0;
  const isLast = currentIndex >= currentPending.length - 1;

  // 1. Botão de Cancelar (topo esquerdo)
  const handleCancel = () => {
    if (currentPhotos.length > 0) {
      confirmAction(
        'Sair do Modo de Fotos',
        'Deseja sair do cadastro em lote? As fotos tiradas deste produto serão descartadas e ele permanecerá inalterado.',
        () => router.back(),
        { confirmText: 'Sair e Descartar', destructive: true }
      );
    } else {
      router.back();
    }
  };

  // 2. Concluir cadastro do produto atual (botão check no topo direito)
  const handleConfirmCurrentProduct = async () => {
    if (!currentProduct) return;

    if (currentPhotos.length === 0) {
      showMessage(
        'Foto necessária',
        'Tire pelo menos 1 foto da embalagem antes de salvar, ou clique na seta para a direita para pular este produto.'
      );
      return;
    }

    if (!store) {
      showMessage('Erro', 'Sessão inválida. Entre novamente.');
      return;
    }

    setSaving(true);
    try {
      await api.updateProduct(store.id, currentProduct.id, {
        photoUris: currentPhotos,
      });

      queryClient.invalidateQueries({ queryKey: ['manager_products'] });
      queryClient.invalidateQueries({ queryKey: ['manager_dashboard'] });

      // Remove o produto concluído da lista pendente local
      const updatedList = currentPending.filter((p: any) => p.id !== currentProduct.id);
      setPendingList(updatedList);
      setCurrentPhotos([]);

      if (updatedList.length === 0) {
        showMessage(
          'Parabéns!',
          'Todas as fotos dos produtos pendentes foram cadastradas com sucesso!',
          () => router.back()
        );
      } else {
        // Se estava no último item, recua o índice para o novo último item
        if (currentIndex >= updatedList.length) {
          setCurrentIndex(updatedList.length - 1);
        }
      }
    } catch (err: any) {
      showMessage('Erro ao salvar foto', err.message || 'Falha ao enviar fotos do produto.');
    } finally {
      setSaving(false);
    }
  };

  // 3. Voltar para o produto anterior (seta esquerda inferior)
  const handlePrevious = () => {
    if (isFirst) return;

    if (currentPhotos.length > 0) {
      confirmAction(
        'Voltar Produto',
        'As fotos tiradas deste produto ainda não foram salvas e serão descartadas. Deseja continuar?',
        () => {
          setCurrentPhotos([]);
          setCurrentIndex((prev) => Math.max(0, prev - 1));
        },
        { confirmText: 'Descartar e Voltar', destructive: true }
      );
    } else {
      setCurrentIndex((prev) => Math.max(0, prev - 1));
    }
  };

  // 4. Passar para o próximo produto (seta direita inferior)
  const handleNext = () => {
    if (isLast) return;

    if (currentPhotos.length > 0) {
      confirmAction(
        'Descartar Fotos?',
        'As fotos tiradas deste produto ainda não foram salvas e serão descartadas ao avançar. Deseja continuar?',
        () => {
          setCurrentPhotos([]);
          setCurrentIndex((prev) => Math.min(currentPending.length - 1, prev + 1));
        },
        { confirmText: 'Descartar e Avançar', destructive: true }
      );
    } else {
      setCurrentIndex((prev) => Math.min(currentPending.length - 1, prev + 1));
    }
  };

  // 5. Botão de Câmera (centro inferior)
  const handleTakePhoto = async () => {
    if (currentPhotos.length >= 4) {
      showMessage('Limite atingido', 'Você pode adicionar no máximo 4 fotos por produto.');
      return;
    }

    try {
      if (Platform.OS === 'web') {
        // Fallback na Web para escolher arquivo de imagem
        const res = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          quality: 0.85,
        });
        if (!res.canceled && res.assets && res.assets.length > 0) {
          setCurrentPhotos((prev) => [...prev, res.assets[0].uri].slice(0, 4));
        }
        return;
      }

      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        showMessage('Permissão necessária', 'Permita o acesso à câmera para fotografar a embalagem.');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        quality: 0.85,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        setCurrentPhotos((prev) => [...prev, result.assets[0].uri].slice(0, 4));
      }
    } catch (e: any) {
      showMessage('Erro ao abrir câmera', e.message);
    }
  };

  const handleRemovePhoto = (photoIdx: number) => {
    setCurrentPhotos((prev) => prev.filter((_, i) => i !== photoIdx));
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerLoading}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Carregando produtos...</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Se não houver produtos com fotos pendentes
  if (!currentProduct || currentPending.length === 0) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.emptyContainer}>
          <Ionicons name="checkmark-done-circle" size={64} color={colors.success} />
          <Text style={styles.emptyTitle}>Tudo em ordem!</Text>
          <Text style={styles.emptySubtitle}>
            Não há produtos pendentes de foto no catálogo no momento.
          </Text>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Text style={styles.backBtnText}>Voltar ao Catálogo</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Topo / Header */}
      <View style={styles.header}>
        {/* Topo Esquerdo: Botão de Cancelar */}
        <TouchableOpacity
          style={styles.headerBtn}
          onPress={handleCancel}
          disabled={saving}
          accessibilityLabel="Cancelar"
        >
          <Ionicons name="close" size={26} color={colors.textPrimary} />
        </TouchableOpacity>

        {/* Meio Superior: Nome do Produto */}
        <View style={styles.headerCenter}>
          <Text style={styles.productName} numberOfLines={1}>
            {currentProduct.name}
          </Text>
          <Text style={styles.productSubtitle} numberOfLines={1}>
            {currentProduct.variant ? `${currentProduct.variant} · ` : ''}
            {currentIndex + 1} de {currentPending.length} pendentes
          </Text>
        </View>

        {/* Topo Direito: Botão de Check */}
        <TouchableOpacity
          style={[
            styles.checkBtn,
            (currentPhotos.length === 0 || saving) && styles.checkBtnDisabled,
          ]}
          onPress={handleConfirmCurrentProduct}
          disabled={saving}
          accessibilityLabel="Concluir cadastro da foto"
        >
          {saving ? (
            <ActivityIndicator size="small" color="#FFF" />
          ) : (
            <Ionicons name="checkmark" size={24} color="#FFF" />
          )}
        </TouchableOpacity>
      </View>

      {/* Meio da tela: Grid de Fotos (inicialmente vazio) */}
      <View style={styles.body}>
        {currentPhotos.length === 0 ? (
          <View style={styles.emptyGridContainer}>
            <View style={styles.emptyGridIconCircle}>
              <Ionicons name="camera-outline" size={48} color={colors.textMuted} />
            </View>
            <Text style={styles.emptyGridTitle}>Nenhuma foto adicionada</Text>
            <Text style={styles.emptyGridSubtitle}>
              Toque no botão de câmera abaixo para fotografar a embalagem de{' '}
              <Text style={styles.bold}>{currentProduct.name}</Text>.
            </Text>
            <View style={styles.tipBox}>
              <Ionicons name="information-circle-outline" size={16} color={colors.primary} />
              <Text style={styles.tipText}>
                Tire até 4 fotos nítidas mostrando a frente e detalhes da embalagem.
              </Text>
            </View>
          </View>
        ) : (
          <View style={styles.gridSection}>
            <View style={styles.gridHeaderRow}>
              <Text style={styles.gridCounterText}>
                Fotos tiradas: <Text style={styles.bold}>{currentPhotos.length}/4</Text>
              </Text>
              <Text style={styles.gridHintText}>Toque no (X) para remover uma foto</Text>
            </View>

            <View style={styles.gridContainer}>
              {[0, 1, 2, 3].map((slotIdx) => {
                const photoUri = currentPhotos[slotIdx];
                if (photoUri) {
                  return (
                    <View key={`slot-${slotIdx}`} style={styles.gridItemWrapper}>
                      <Image
                        source={{ uri: photoUri }}
                        style={styles.gridPhoto}
                        contentFit="cover"
                      />
                      <View style={styles.photoIndexBadge}>
                        <Text style={styles.photoIndexBadgeText}>#{slotIdx + 1}</Text>
                      </View>
                      <TouchableOpacity
                        style={styles.removePhotoBtn}
                        onPress={() => handleRemovePhoto(slotIdx)}
                      >
                        <Ionicons name="close" size={14} color="#FFF" />
                      </TouchableOpacity>
                    </View>
                  );
                }

                // Slot vazio restante
                return (
                  <View key={`slot-${slotIdx}`} style={styles.emptySlot}>
                    <Ionicons name="image-outline" size={24} color={colors.surfaceBorderStrong} />
                    <Text style={styles.emptySlotText}>Foto {slotIdx + 1}</Text>
                  </View>
                );
              })}
            </View>
          </View>
        )}
      </View>

      {/* Controles Inferiores */}
      <View style={styles.bottomBar}>
        {/* Canto Inferior Esquerdo: Seta para Esquerda */}
        <TouchableOpacity
          style={[styles.arrowBtn, isFirst && styles.arrowBtnDisabled]}
          onPress={handlePrevious}
          disabled={isFirst || saving}
          accessibilityLabel="Produto anterior"
        >
          <Ionicons
            name="arrow-back"
            size={28}
            color={isFirst ? colors.surfaceBorderStrong : colors.textPrimary}
          />
        </TouchableOpacity>

        {/* Centro Inferior: Botão de Câmera */}
        <TouchableOpacity
          style={[
            styles.cameraMainBtn,
            currentPhotos.length >= 4 && styles.cameraMainBtnMax,
          ]}
          onPress={handleTakePhoto}
          disabled={saving}
          accessibilityLabel="Tirar foto"
        >
          <Ionicons name="camera" size={34} color="#FFF" />
        </TouchableOpacity>

        {/* Canto Inferior Direito: Seta para Direita */}
        <TouchableOpacity
          style={[styles.arrowBtn, isLast && styles.arrowBtnDisabled]}
          onPress={handleNext}
          disabled={isLast || saving}
          accessibilityLabel="Próximo produto"
        >
          <Ionicons
            name="arrow-forward"
            size={28}
            color={isLast ? colors.surfaceBorderStrong : colors.textPrimary}
          />
        </TouchableOpacity>
      </View>
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
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceBorder,
    backgroundColor: colors.surface,
  },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
    marginHorizontal: 12,
  },
  productName: {
    ...typography.h3,
    fontSize: 16,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  productSubtitle: {
    ...typography.caption,
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
    textAlign: 'center',
  },
  checkBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
  },
  checkBtnDisabled: {
    backgroundColor: colors.textMuted,
    opacity: 0.6,
  },
  body: {
    flex: 1,
    padding: 16,
    justifyContent: 'center',
  },
  emptyGridContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  emptyGridIconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.surfaceSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    borderWidth: 2,
    borderColor: colors.surfaceBorder,
    borderStyle: 'dashed',
  },
  emptyGridTitle: {
    ...typography.h3,
    fontSize: 16,
    color: colors.textPrimary,
    marginBottom: 8,
  },
  emptyGridSubtitle: {
    ...typography.body,
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 20,
  },
  bold: {
    fontWeight: '700',
    color: colors.textPrimary,
  },
  tipBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surfaceSubtle,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  tipText: {
    ...typography.caption,
    fontSize: 12,
    color: colors.textSecondary,
    flex: 1,
  },
  gridSection: {
    flex: 1,
    justifyContent: 'center',
  },
  gridHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  gridCounterText: {
    ...typography.body,
    fontSize: 13,
    color: colors.textSecondary,
  },
  gridHintText: {
    ...typography.caption,
    fontSize: 11,
    color: colors.textMuted,
  },
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'center',
  },
  gridItemWrapper: {
    width: '46%',
    aspectRatio: 1,
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  gridPhoto: {
    width: '100%',
    height: '100%',
  },
  photoIndexBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  photoIndexBadgeText: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: '700',
  },
  removePhotoBtn: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptySlot: {
    width: '46%',
    aspectRatio: 1,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.surfaceBorder,
    borderStyle: 'dashed',
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  emptySlotText: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '600',
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 36,
    paddingTop: 12,
    paddingBottom: 28,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceBorder,
  },
  arrowBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.surfaceSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  arrowBtnDisabled: {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
  },
  cameraMainBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 5,
  },
  cameraMainBtnMax: {
    backgroundColor: colors.textMuted,
    opacity: 0.8,
  },
  centerLoading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    ...typography.body,
    color: colors.textMuted,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 12,
  },
  emptyTitle: {
    ...typography.h2,
    color: colors.textPrimary,
  },
  emptySubtitle: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 8,
  },
  backBtn: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    backgroundColor: colors.primary,
    borderRadius: 10,
  },
  backBtnText: {
    color: '#FFF',
    fontWeight: '700',
    fontSize: 14,
  },
});
