import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../../../services/api';
import { type CaptureProgress, subscribeCaptureJob } from '../../../../services/capture';
import { Card } from '../../../../components/Card';
import { Button } from '../../../../components/Button';
import { colors, typography } from '../../../../constants/theme';

export default function AnalyzingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [local, setLocal] = useState<CaptureProgress | null>(null);

  // Progresso da seleção/envio de quadros feita neste aparelho.
  useEffect(() => (id ? subscribeCaptureJob(id, setLocal) : undefined), [id]);

  const { data: task } = useQuery({
    queryKey: ['task_analyzing', id],
    queryFn: () => api.getTask(id),
    refetchInterval: 1500,
    enabled: Boolean(id),
  });

  useEffect(() => {
    if (!task) return;

    if (task.status === 'review' || task.status === 'submitted' || task.status === 'approved') {
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => null);
      }
      router.replace(`/(employee)/task/${id}/review`);
    }
  }, [task?.status, id, router]);

  const capture = task?.capture;
  const stage = capture?.stage;
  // Falha antes de a captura existir (ex.: contagem já enviada por outra pessoa).
  const startFailed = local?.phase === 'failed' && task && task.status !== 'analyzing';

  const getStageInfo = () => {
    if (startFailed) {
      return {
        step: 'Não foi possível analisar',
        title: 'O vídeo não foi enviado',
        desc: local?.error || 'Tente filmar novamente ou faça a contagem manual.',
      };
    }
    if (local?.phase === 'preparing' || local?.phase === 'scoring') {
      return {
        step: 'Etapa 1 de 3',
        title: 'Selecionando quadros no aparelho…',
        desc: local.total
          ? `Analisando nitidez e repetição: ${local.done} de ${local.total} quadros.`
          : 'Abrindo o vídeo para escolher as imagens mais nítidas da prateleira.',
      };
    }
    if (local?.phase === 'uploading') {
      return {
        step: 'Etapa 1 de 3',
        title: 'Enviando quadros escolhidos…',
        desc: `${local.done} de ${local.total} imagens enviadas. Mantenha o app aberto.`,
      };
    }
    switch (stage) {
      case 'frames':
        return {
          step: 'Etapa 1 de 3',
          title: 'Aguardando os quadros do vídeo…',
          desc: 'Os quadros são escolhidos no aparelho que filmou. Mantenha o app aberto nele.',
        };
      case 'identifying':
        return {
          step: 'Etapa 2 de 3',
          title: 'Reconhecendo produtos…',
          desc: 'Comparando as embalagens com as fotos de referência do catálogo.',
        };
      case 'counting':
        return {
          step: 'Etapa 3 de 3',
          title: 'Contando unidades físicas…',
          desc: 'Examinando visões de frente, topo e laterais para separar cada unidade.',
        };
      default:
        return {
          step: 'Preparando análise',
          title: 'Iniciando processamento com IA…',
          desc: 'Aguarde alguns segundos enquanto a filmagem é analisada.',
        };
    }
  };

  const stageInfo = getStageInfo();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.spinnerContainer}>
          <View style={styles.pulseRing}>
            {startFailed ? (
              <Ionicons name="alert-circle-outline" size={40} color={colors.dangerText} />
            ) : (
              <ActivityIndicator size="large" color={colors.primary} />
            )}
          </View>
        </View>

        <Text style={styles.stepBadge}>{stageInfo.step}</Text>
        <Text style={styles.title}>{stageInfo.title}</Text>
        <Text style={styles.description}>{stageInfo.desc}</Text>

        <Card style={styles.infoCard}>
          <View style={styles.infoRow}>
            <Ionicons name="sparkles" size={20} color={colors.primary} />
            <Text style={styles.infoTitle}>Como a IA trabalha:</Text>
          </View>
          <Text style={styles.infoText}>
            O ContaBot nunca soma imagens independentes. Ele consolida uma contagem única para evitar duplicar caixas que aparecem em vários momentos do vídeo.
          </Text>
        </Card>

        {startFailed ? (
          <Button
            title="Voltar para a contagem"
            onPress={() => router.replace(`/(employee)/task/${id}`)}
            variant="outline"
            style={styles.skipBtn}
          />
        ) : (
          <Button
            title="Conferir Manualmente (Pular IA)"
            onPress={async () => {
              await api.switchToManual(id).catch(() => null);
              router.replace(`/(employee)/task/${id}/review`);
            }}
            variant="ghost"
            style={styles.skipBtn}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 28,
  },
  spinnerContainer: {
    marginBottom: 28,
  },
  pulseRing: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepBadge: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.primary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  title: {
    ...typography.h2,
    fontSize: 22,
    textAlign: 'center',
    marginBottom: 8,
  },
  description: {
    ...typography.body,
    textAlign: 'center',
    color: colors.textSecondary,
    marginBottom: 32,
    maxWidth: 320,
    lineHeight: 22,
  },
  infoCard: {
    padding: 18,
    width: '100%',
    backgroundColor: colors.surface,
    marginBottom: 20,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  infoTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
    marginLeft: 8,
  },
  infoText: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 19,
  },
  skipBtn: {
    marginTop: 8,
  },
});
