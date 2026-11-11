import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../../../context/AuthContext';
import { api } from '../../../../services/api';
import { CAPTURE_SETTINGS, startCaptureJob } from '../../../../services/capture';
import { Button } from '../../../../components/Button';
import { colors } from '../../../../constants/theme';

/** Segundos iniciais da gravação dedicados à vista de cima da prateleira. */
const OVERVIEW_SECONDS = 5;

export default function CameraRecorderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { config } = useAuth();
  // Teste com IA real: em varreduras longas a identificação perde produtos.
  // Vídeo curto de uma única prateleira, nunca acima do teto do processamento.
  const maxDuration = Math.min(config?.max_video_seconds || 30, CAPTURE_SETTINGS.maxDurationSeconds);

  // Mesma consulta da tela da contagem (vem do cache): nome da área a filmar.
  const { data: task } = useQuery({
    queryKey: ['task_detail', id],
    queryFn: () => api.getTask(id),
    enabled: Boolean(id),
  });
  const areaName: string | undefined = task?.area?.name;

  const cameraRef = useRef<CameraView>(null);
  // A análise usa só imagens: a câmera grava sem áudio (prop mute) e o app não
  // pede permissão de microfone nem capta conversas na loja.
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  const [torch, setTorch] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedUri, setRecordedUri] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isUploading, setIsUploading] = useState(false);

  const timerRef = useRef<any>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const triggerHaptic = () => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => null);
    }
  };

  const startTimer = () => {
    setElapsedSeconds(0);
    timerRef.current = setInterval(() => {
      setElapsedSeconds((prev) => {
        if (prev + 1 >= maxDuration) {
          stopRecording();
          return maxDuration;
        }
        return prev + 1;
      });
    }, 1000);
  };

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const startRecording = async () => {
    if (!cameraRef.current || isRecording) return;
    triggerHaptic();
    setIsRecording(true);
    startTimer();

    try {
      const videoResult = await cameraRef.current.recordAsync({
        maxDuration: maxDuration,
      });
      if (videoResult && videoResult.uri) {
        setRecordedUri(videoResult.uri);
      }
    } catch (err: any) {
      console.warn('Erro na gravação:', err);
    } finally {
      setIsRecording(false);
      stopTimer();
    }
  };

  const stopRecording = () => {
    if (!cameraRef.current || !isRecording) return;
    triggerHaptic();
    try {
      cameraRef.current.stopRecording();
    } catch (err) {
      console.warn('Erro ao parar gravação:', err);
    }
    setIsRecording(false);
    stopTimer();
  };

  const handleConfirmUpload = async () => {
    if (!recordedUri) return;
    setIsUploading(true);
    try {
      // Seleção de quadros, envio e análise seguem em segundo plano.
      startCaptureJob(id, recordedUri);
      router.replace(`/(employee)/task/${id}/analyzing`);
    } catch (err: any) {
      Alert.alert('Erro ao enviar vídeo', err.message || 'Falha no envio.');
      setIsUploading(false);
    }
  };

  const handleRetake = () => {
    setRecordedUri(null);
    setElapsedSeconds(0);
  };

  const formatTimer = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // Orientação que acompanha a gravação: primeiro a visão geral (de onde a IA
  // conta as fileiras), depois a passagem pela frente (de onde identifica).
  const remaining = maxDuration - elapsedSeconds;
  const recordingHint =
    remaining <= 5
      ? `Finalizando em ${remaining}s…`
      : elapsedSeconds < OVERVIEW_SECONDS
        ? 'Comece de cima: mostre a prateleira inteira'
        : 'Agora passe devagar pela frente das caixas';

  // If permission not determined yet
  if (!cameraPermission) {
    return (
      <View style={styles.permissionContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  // If permission denied or not granted
  if (!cameraPermission.granted) {
    return (
      <SafeAreaView style={styles.permissionContainer}>
        <Ionicons name="camera-outline" size={64} color={colors.primary} />
        <Text style={styles.permissionTitle}>Permissão de Câmera Necessária</Text>
        <Text style={styles.permissionSubtitle}>
          O ContaBot precisa de acesso à câmera para filmar a prateleira e contar os produtos visualmente.
        </Text>
        <Button
          title="Permitir Acesso à Câmera"
          onPress={requestCameraPermission}
          size="lg"
          style={styles.permissionBtn}
        />
        <Button
          title="Voltar"
          onPress={() => router.back()}
          variant="outline"
          style={styles.permissionBtn}
        />
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.container}>
      {/* Camera View */}
      {!recordedUri ? (
        <CameraView
          ref={cameraRef}
          style={styles.camera}
          facing="back"
          mode="video"
          mute
          enableTorch={torch}
        >
          {/* Top Bar with Guidelines & Torch */}
          <SafeAreaView style={styles.topBar}>
            <TouchableOpacity onPress={() => router.back()} style={styles.iconCircle}>
              <Ionicons name="close" size={24} color="#FFF" />
            </TouchableOpacity>

            <View style={styles.timerBadge}>
              <View style={[styles.timerDot, isRecording && styles.timerDotActive]} />
              <Text style={styles.timerText}>
                {formatTimer(elapsedSeconds)} / {formatTimer(maxDuration)}
              </Text>
            </View>

            <TouchableOpacity
              onPress={() => setTorch(!torch)}
              style={[styles.iconCircle, torch && styles.iconCircleActive]}
            >
              <Ionicons name={torch ? 'flash' : 'flash-off'} size={22} color="#FFF" />
            </TouchableOpacity>
          </SafeAreaView>

          {/* Guide Overlay */}
          <View style={styles.guideContainer} pointerEvents="none">
            <View style={styles.guideBox}>
              <View style={[styles.corner, styles.cornerTL]} />
              <View style={[styles.corner, styles.cornerTR]} />
              <View style={[styles.corner, styles.cornerBL]} />
              <View style={[styles.corner, styles.cornerBR]} />
              <Text style={styles.guideText}>
                {isRecording ? recordingHint : 'Enquadre só a prateleira desta contagem'}
              </Text>
            </View>
          </View>

          {!isRecording && (
            <View style={styles.tipsCard} pointerEvents="none">
              <Text style={styles.tipsTitle}>
                {areaName ? `Filme só: ${areaName}` : 'Filme só a prateleira desta contagem'}
              </Text>
              {[
                ['eye-outline', `Comece de cima, mostrando todas as caixas (${OVERVIEW_SECONDS} s)`],
                ['swap-horizontal', 'Depois passe devagar pela frente dos produtos'],
                ['timer-outline', `Até ${maxDuration} s. Outras prateleiras atrapalham a contagem`],
              ].map(([icon, text]) => (
                <View key={text} style={styles.tipRow}>
                  <Ionicons name={icon as keyof typeof Ionicons.glyphMap} size={16} color="#FFF" />
                  <Text style={styles.tipText}>{text}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Bottom Controls */}
          <SafeAreaView style={styles.bottomBar}>
            <View style={styles.controlsRow}>
              <View style={{ width: 50 }} />

              {/* Shutter Button */}
              <TouchableOpacity
                onPress={isRecording ? stopRecording : startRecording}
                style={[styles.shutterOuter, isRecording && styles.shutterOuterRecording]}
                activeOpacity={0.8}
              >
                <View style={[styles.shutterInner, isRecording && styles.shutterInnerRecording]} />
              </TouchableOpacity>

              <View style={{ width: 50 }} />
            </View>
            <Text style={styles.shutterHint}>
              {isRecording ? 'Toque no quadrado para finalizar' : 'Toque no botão para iniciar filmagem'}
            </Text>
          </SafeAreaView>
        </CameraView>
      ) : (
        /* Video Recorded Confirmation Screen */
        <SafeAreaView style={styles.previewContainer}>
          <View style={styles.previewHeader}>
            <Text style={styles.previewTitle}>Filmagem Concluída</Text>
            <Text style={styles.previewSubtitle}>
              Duração gravada: {formatTimer(elapsedSeconds)}
            </Text>
          </View>

          <View style={styles.previewCard}>
            <Ionicons name="checkmark-circle-outline" size={80} color={colors.primary} />
            <Text style={styles.previewCardTitle}>Vídeo pronto para análise</Text>
            <Text style={styles.previewCardDesc}>
              Ao enviar, a inteligência artificial analisará os frames e preparará a contagem dos produtos desta área.
            </Text>
          </View>

          <View style={styles.previewActions}>
            <Button
              title="Enviar para Análise IA"
              onPress={handleConfirmUpload}
              loading={isUploading}
              size="lg"
              iconRight={<Ionicons name="sparkles" size={20} color="#FFF" />}
              style={styles.actionButton}
            />

            <Button
              title="Gravar Novamente"
              onPress={handleRetake}
              disabled={isUploading}
              variant="outline"
              style={styles.actionButton}
            />
          </View>
        </SafeAreaView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  camera: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconCircleActive: {
    backgroundColor: colors.primary,
  },
  timerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 20,
  },
  timerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#94A3B8',
    marginRight: 8,
  },
  timerDotActive: {
    backgroundColor: '#EF4444',
  },
  timerText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 1,
  },
  guideContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 30,
  },
  guideBox: {
    width: '100%',
    height: 260,
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  corner: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderColor: '#FFF',
  },
  cornerTL: {
    top: 0,
    left: 0,
    borderTopWidth: 3,
    borderLeftWidth: 3,
  },
  cornerTR: {
    top: 0,
    right: 0,
    borderTopWidth: 3,
    borderRightWidth: 3,
  },
  cornerBL: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
  },
  cornerBR: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 3,
    borderRightWidth: 3,
  },
  guideText: {
    color: '#FFF',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    maxWidth: '90%',
  },
  tipsCard: {
    marginHorizontal: 20,
    marginBottom: 16,
    padding: 14,
    borderRadius: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  tipsTitle: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 8,
  },
  tipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  tipText: {
    color: 'rgba(255, 255, 255, 0.9)',
    fontSize: 13,
    marginLeft: 8,
    flexShrink: 1,
  },
  bottomBar: {
    paddingBottom: 24,
    alignItems: 'center',
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    paddingHorizontal: 40,
    marginBottom: 10,
  },
  shutterOuter: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 4,
    borderColor: '#FFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  shutterOuterRecording: {
    borderColor: '#EF4444',
  },
  shutterInner: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#EF4444',
  },
  shutterInnerRecording: {
    width: 32,
    height: 32,
    borderRadius: 6,
    backgroundColor: '#EF4444',
  },
  shutterHint: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 13,
    fontWeight: '500',
  },
  permissionContainer: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 30,
  },
  permissionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.textPrimary,
    marginTop: 20,
    marginBottom: 8,
    textAlign: 'center',
  },
  permissionSubtitle: {
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 28,
    lineHeight: 22,
  },
  permissionBtn: {
    width: '100%',
    marginBottom: 12,
  },
  previewContainer: {
    flex: 1,
    backgroundColor: colors.background,
    padding: 24,
    justifyContent: 'space-between',
  },
  previewHeader: {
    alignItems: 'center',
    marginTop: 20,
  },
  previewTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  previewSubtitle: {
    fontSize: 15,
    color: colors.textSecondary,
    marginTop: 4,
  },
  previewCard: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 30,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  previewCardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
    marginTop: 16,
    marginBottom: 8,
  },
  previewCardDesc: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  previewActions: {
    width: '100%',
  },
  actionButton: {
    marginBottom: 12,
  },
});
