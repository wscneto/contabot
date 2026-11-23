import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from './Card';
import { colors, typography } from '../constants/theme';

export interface OnboardingChecklistProps {
  hasProducts: boolean;
  hasProductPhotos: boolean;
  hasAreas: boolean;
  hasAnyTask: boolean;
  onProductsPress: () => void;
  onAreasPress: () => void;
  onStartCountPress: () => void;
  onInviteTeamPress?: () => void;
  onDismiss?: () => void;
}

interface StepItem {
  key: string;
  title: string;
  subtitle: string;
  done: boolean;
  onPress: () => void;
  ctaLabel: string;
}

export const OnboardingChecklistCard: React.FC<OnboardingChecklistProps> = ({
  hasProducts,
  hasProductPhotos,
  hasAreas,
  hasAnyTask,
  onProductsPress,
  onAreasPress,
  onStartCountPress,
  onInviteTeamPress,
  onDismiss,
}) => {
  const productsDone = hasProducts && hasProductPhotos;
  const steps: StepItem[] = [
    {
      key: 'products',
      title: '1. Cadastrar produtos com foto',
      subtitle:
        hasProducts && !hasProductPhotos
          ? 'Você já cadastrou produtos, mas falta fotografar as embalagens para a IA reconhecê-los.'
          : 'Cadastre manualmente ou importe uma planilha e tire fotos nítidas das embalagens.',
      done: productsDone,
      onPress: onProductsPress,
      ctaLabel: hasProducts && !hasProductPhotos ? 'Adicionar fotos' : 'Cadastrar produtos',
    },
    {
      key: 'areas',
      title: '2. Criar áreas da loja',
      subtitle: 'Agrupe os produtos por gôndola, prateleira ou depósito para acelerar a filmagem.',
      done: hasAreas,
      onPress: onAreasPress,
      ctaLabel: 'Criar área',
    },
    {
      key: 'count',
      title: '3. Iniciar a primeira contagem',
      subtitle: 'Você pode filmar e contar sozinho ou atribuir para um funcionário da equipe.',
      done: hasAnyTask,
      onPress: onStartCountPress,
      ctaLabel: 'Nova contagem',
    },
  ];

  const completedCount = steps.filter((s) => s.done).length;
  if (completedCount === steps.length) {
    return null;
  }

  const nextStepKey = steps.find((s) => !s.done)?.key;
  const progressPct = `${Math.round((completedCount / steps.length) * 100)}%` as const;

  return (
    <Card style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.titleCol}>
          <View style={styles.titleRow}>
            <Ionicons name="rocket-outline" size={18} color={colors.primary} />
            <Text style={styles.title}>Primeiros passos da loja</Text>
          </View>
          <Text style={styles.progressLabel}>
            {completedCount} de {steps.length} concluídos
          </Text>
        </View>

        {onDismiss && (
          <TouchableOpacity
            onPress={onDismiss}
            style={styles.dismissBtn}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Ocultar guia inicial"
          >
            <Ionicons name="close" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: progressPct }]} />
      </View>

      <View style={styles.stepsList}>
        {steps.map((step) => {
          const isCurrent = step.key === nextStepKey;
          return (
            <TouchableOpacity
              key={step.key}
              style={[
                styles.stepRow,
                step.done && styles.stepRowDone,
                isCurrent && styles.stepRowCurrent,
              ]}
              onPress={step.onPress}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel={`${step.title}: ${step.done ? 'concluído' : step.ctaLabel}`}
            >
              <Ionicons
                name={step.done ? 'checkmark-circle' : isCurrent ? 'ellipse-outline' : 'radio-button-off'}
                size={22}
                color={step.done ? colors.success : isCurrent ? colors.primary : colors.textMuted}
                style={styles.stepIcon}
              />

              <View style={styles.stepTextCol}>
                <Text style={[styles.stepTitle, step.done && styles.stepTitleDone]}>
                  {step.title}
                </Text>
                {!step.done && <Text style={styles.stepSubtitle}>{step.subtitle}</Text>}
                {isCurrent && (
                  <View style={styles.stepCtaRow}>
                    <Text style={styles.stepCtaText}>{step.ctaLabel}</Text>
                    <Ionicons name="arrow-forward" size={13} color={colors.primary} />
                  </View>
                )}
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      {onInviteTeamPress && (
        <TouchableOpacity style={styles.teamLinkRow} onPress={onInviteTeamPress}>
          <Ionicons name="people-outline" size={15} color={colors.primary} />
          <Text style={styles.teamLinkText}>Quer delegar? Cadastre sua equipe com código ou QR</Text>
        </TouchableOpacity>
      )}
    </Card>
  );
};

const styles = StyleSheet.create({
  card: {
    padding: 16,
    marginBottom: 20,
    borderColor: '#99F6E4',
    backgroundColor: colors.surface,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  titleCol: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  title: {
    ...typography.h3,
    fontSize: 16,
    color: colors.textPrimary,
  },
  progressLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
    fontWeight: '600',
  },
  dismissBtn: {
    padding: 4,
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.surfaceSubtle,
    overflow: 'hidden',
    marginBottom: 14,
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 3,
  },
  stepsList: {
    gap: 8,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 10,
    borderRadius: 10,
    backgroundColor: colors.surfaceSubtle,
  },
  stepRowCurrent: {
    backgroundColor: colors.primaryLight,
    borderWidth: 1,
    borderColor: '#99F6E4',
  },
  stepRowDone: {
    backgroundColor: colors.successBg,
  },
  stepIcon: {
    marginRight: 10,
    marginTop: 1,
  },
  stepTextCol: {
    flex: 1,
  },
  stepTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  stepTitleDone: {
    color: colors.successText,
    textDecorationLine: 'line-through',
  },
  stepSubtitle: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
    lineHeight: 17,
  },
  stepCtaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 6,
  },
  stepCtaText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primaryDark,
  },
  teamLinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceBorder,
  },
  teamLinkText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.primary,
    flex: 1,
  },
});
