import React, { useState } from 'react';
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
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { api } from '../../../../services/api';
import { CAPTURE_SETTINGS, startCaptureJob } from '../../../../services/capture';
import { useAuth } from '../../../../context/AuthContext';
import { Header } from '../../../../components/Header';
import { Badge } from '../../../../components/Badge';
import { Button } from '../../../../components/Button';
import { Card } from '../../../../components/Card';
import { colors, typography } from '../../../../constants/theme';

export default function TaskStartScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { config } = useAuth();
  const maxVideoSeconds = Math.min(config?.max_video_seconds || 30, CAPTURE_SETTINGS.maxDurationSeconds);

  const [uploadingGallery, setUploadingGallery] = useState(false);

  const { data: task, isLoading, refetch } = useQuery({
    queryKey: ['task_detail', id],
    queryFn: () => api.getTask(id),
    enabled: Boolean(id),
  });

  if (isLoading || !task) {
    return (
      <SafeAreaView style={styles.container}>
        <Header title="Carregando…" showBack />
        <View style={styles.loadingCenter}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  const handlePickGalleryVideo = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permissão necessária', 'Permita o acesso à galeria para enviar um vídeo.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['videos'],
        allowsEditing: false,
        quality: 1,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        // duration vem em milissegundos. Avisa antes de criar a captura, em vez
        // de falhar depois na tela de análise.
        const seconds = (asset.duration ?? 0) / 1000;
        if (seconds > CAPTURE_SETTINGS.maxDurationSeconds + 0.5) {
          Alert.alert(
            'Vídeo longo demais',
            `Este vídeo tem ${Math.round(seconds)} s. Use até ${CAPTURE_SETTINGS.maxDurationSeconds} s mostrando só a prateleira desta contagem: em vídeos longos a IA pode deixar produtos de fora.`,
          );
          return;
        }
        setUploadingGallery(true);
        startCaptureJob(task.id, asset.uri);
        router.replace(`/(employee)/task/${task.id}/analyzing`);
      }
    } catch (err: any) {
      Alert.alert('Erro ao enviar vídeo', err.message || 'Não foi possível enviar o vídeo.');
    } finally {
      setUploadingGallery(false);
    }
  };

  const handleManualCounting = async () => {
    try {
      await api.switchToManual(task.id);
      router.replace(`/(employee)/task/${task.id}/review`);
    } catch (err: any) {
      Alert.alert('Erro', err.message || 'Não foi possível iniciar contagem manual.');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <Header title="Iniciar Contagem" showBack />

      <ScrollView contentContainerStyle={styles.content}>
        {/* Recount banner if requested */}
        {task.recount_requested && (
          <View style={styles.recountBox}>
            <View style={styles.recountHeader}>
              <Ionicons name="alert-circle" size={20} color={colors.warningText} />
              <Text style={styles.recountTitle}>Recontagem Solicitada</Text>
            </View>
            <Text style={styles.recountNote}>"{task.manager_note}"</Text>
          </View>
        )}

        {/* Area Info Card */}
        <Card style={styles.areaCard}>
          <View style={styles.areaRow}>
            <View style={styles.areaCol}>
              <Text style={styles.areaName}>{task.area?.name}</Text>
              {task.area?.description ? (
                <Text style={styles.areaDesc}>{task.area.description}</Text>
              ) : null}
            </View>
            <Badge variant={task.status} />
          </View>

          {task.note ? (
            <View style={styles.taskNote}>
              <Text style={styles.taskNoteLabel}>Instruções do Gerente:</Text>
              <Text style={styles.taskNoteText}>{task.note}</Text>
            </View>
          ) : null}
        </Card>

        {/* Existing Stage Redirections */}
        {task.status === 'analyzing' && (
          <Card style={styles.actionCard}>
            <Text style={styles.actionTitle}>Vídeo em Processamento</Text>
            <Text style={styles.actionDesc}>
              A inteligência artificial está analisando a filmagem enviada anteriormente.
            </Text>
            <Button
              title="Acompanhar Análise"
              onPress={() => router.push(`/(employee)/task/${task.id}/analyzing`)}
              size="lg"
            />
          </Card>
        )}

        {task.status === 'review' && (
          <Card style={styles.actionCard}>
            <Text style={styles.actionTitle}>Contagem Pronta para Conferência</Text>
            <Text style={styles.actionDesc}>
              Os números sugeridos pela IA já estão disponíveis. Revise e confirme antes de enviar.
            </Text>
            <Button
              title="Ir para Conferência"
              onPress={() => router.push(`/(employee)/task/${task.id}/review`)}
              size="lg"
            />
          </Card>
        )}

        {/* Choose Counting Method */}
        {task.status === 'open' && (
          <View style={styles.methodsContainer}>
            <Text style={styles.methodsTitle}>Como deseja contar?</Text>

            {/* Method 1: Camera (Primary) */}
            <TouchableOpacity
              style={styles.methodCardPrimary}
              onPress={() => router.push(`/(employee)/task/${task.id}/camera`)}
            >
              <View style={styles.methodIconCircle}>
                <Ionicons name="videocam" size={28} color={colors.surface} />
              </View>
              <View style={styles.methodTextCol}>
                <Text style={styles.methodTitlePrimary}>Filmar Prateleira (Recomendado)</Text>
                <Text style={styles.methodDescPrimary}>
                  Grave até {maxVideoSeconds} segundos só desta prateleira, começando de cima. A IA identificará os produtos e sugerirá as quantidades.
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.surface} />
            </TouchableOpacity>

            {/* Method 2: Gallery Video */}
            <TouchableOpacity
              style={styles.methodCard}
              onPress={handlePickGalleryVideo}
              disabled={uploadingGallery}
            >
              <View style={styles.methodIconSecondary}>
                {uploadingGallery ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Ionicons name="film-outline" size={24} color={colors.primary} />
                )}
              </View>
              <View style={styles.methodTextCol}>
                <Text style={styles.methodTitle}>Escolher Vídeo da Galeria</Text>
                <Text style={styles.methodDesc}>
                  Selecione um vídeo de até {CAPTURE_SETTINGS.maxDurationSeconds} segundos gravado só desta prateleira.
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
            </TouchableOpacity>

            {/* Method 3: Manual */}
            <TouchableOpacity
              style={styles.methodCard}
              onPress={handleManualCounting}
            >
              <View style={styles.methodIconSecondary}>
                <Ionicons name="create-outline" size={24} color={colors.textSecondary} />
              </View>
              <View style={styles.methodTextCol}>
                <Text style={styles.methodTitle}>Contar Manualmente</Text>
                <Text style={styles.methodDesc}>
                  Insira as quantidades item a item sem utilizar o leitor de vídeo.
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        )}

        {/* Expected Products List */}
        <View style={styles.productsSection}>
          <Text style={styles.sectionHeading}>
            Produtos Esperados nesta Área ({task.items?.length || 0})
          </Text>

          {task.items?.map((item: any) => {
            const photoUrl = api.resolveMediaUrl(item.photo);
            return (
              <Card key={item.product_id} style={styles.prodItemCard} variant="outlined">
                {photoUrl ? (
                  <Image source={{ uri: photoUrl }} style={styles.prodThumb} contentFit="cover" />
                ) : (
                  <View style={styles.prodThumbEmpty}>
                    <Ionicons name="cube-outline" size={22} color={colors.textMuted} />
                  </View>
                )}
                <View style={styles.prodInfo}>
                  <Text style={styles.prodName}>{item.name}</Text>
                  {item.variant ? <Text style={styles.prodVariant}>{item.variant}</Text> : null}
                </View>
              </Card>
            );
          })}
        </View>
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
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  recountBox: {
    backgroundColor: colors.warningBg,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1.5,
    borderColor: colors.warning,
  },
  recountHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  recountTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.warningText,
    marginLeft: 8,
  },
  recountNote: {
    fontSize: 14,
    color: colors.textPrimary,
    fontStyle: 'italic',
  },
  areaCard: {
    padding: 18,
    marginBottom: 20,
  },
  areaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  areaCol: {
    flex: 1,
    marginRight: 12,
  },
  areaName: {
    ...typography.h2,
    fontSize: 20,
  },
  areaDesc: {
    ...typography.caption,
    marginTop: 4,
  },
  taskNote: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceBorder,
  },
  taskNoteLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
    marginBottom: 2,
  },
  taskNoteText: {
    fontSize: 14,
    color: colors.textPrimary,
  },
  actionCard: {
    padding: 20,
    marginBottom: 20,
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  actionTitle: {
    ...typography.h3,
    marginBottom: 6,
    color: colors.primaryDark,
  },
  actionDesc: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: 16,
  },
  methodsContainer: {
    marginBottom: 24,
  },
  methodsTitle: {
    ...typography.h3,
    fontSize: 17,
    marginBottom: 14,
  },
  methodCardPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  methodIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  methodTextCol: {
    flex: 1,
    marginRight: 8,
  },
  methodTitlePrimary: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.surface,
    marginBottom: 4,
  },
  methodDescPrimary: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.9)',
    lineHeight: 18,
  },
  methodCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  methodIconSecondary: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.surfaceSubtle,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  methodTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 2,
  },
  methodDesc: {
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 16,
  },
  productsSection: {
    marginTop: 8,
  },
  sectionHeading: {
    ...typography.h3,
    fontSize: 16,
    marginBottom: 12,
    color: colors.textSecondary,
  },
  prodItemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    marginBottom: 8,
    borderRadius: 10,
  },
  prodThumb: {
    width: 44,
    height: 44,
    borderRadius: 8,
    marginRight: 12,
  },
  prodThumbEmpty: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: colors.surfaceSubtle,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  prodInfo: {
    flex: 1,
  },
  prodName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  prodVariant: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 1,
  },
});
