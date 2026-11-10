import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors } from '../constants/theme';

export type BadgeVariant =
  | 'open'
  | 'analyzing'
  | 'review'
  | 'submitted'
  | 'approved'
  | 'ok'
  | 'check'
  | 'missing'
  | 'manual'
  | 'neutral'
  | 'danger';

interface BadgeProps {
  label?: string;
  variant: BadgeVariant;
  size?: 'sm' | 'md';
  style?: ViewStyle;
}

const variantStyles: Record<BadgeVariant, { bg: string; text: string; defaultLabel: string }> = {
  open: { bg: colors.surfaceSubtle, text: colors.textSecondary, defaultLabel: 'Aberto' },
  analyzing: { bg: colors.infoBg, text: colors.infoText, defaultLabel: 'Processando IA' },
  review: { bg: colors.warningBg, text: colors.warningText, defaultLabel: 'Conferir' },
  submitted: { bg: colors.purpleBg, text: colors.purpleText, defaultLabel: 'Aguardando Gerente' },
  approved: { bg: colors.successBg, text: colors.successText, defaultLabel: 'Aprovada' },

  ok: { bg: colors.successBg, text: colors.successText, defaultLabel: 'Confirmado IA' },
  check: { bg: colors.warningBg, text: colors.warningText, defaultLabel: 'Revisar IA' },
  missing: { bg: colors.dangerBg, text: colors.dangerText, defaultLabel: 'Não avistado' },
  manual: { bg: colors.surfaceSubtle, text: colors.textSecondary, defaultLabel: 'Manual' },

  neutral: { bg: colors.surfaceSubtle, text: colors.textSecondary, defaultLabel: '' },
  danger: { bg: colors.dangerBg, text: colors.dangerText, defaultLabel: 'Atenção' },
};

export const Badge: React.FC<BadgeProps> = ({ label, variant, size = 'md', style }) => {
  const conf = variantStyles[variant] || variantStyles.neutral;
  const isSm = size === 'sm';

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: conf.bg },
        isSm ? styles.containerSm : styles.containerMd,
        style,
      ]}
    >
      <Text
        style={[
          styles.text,
          { color: conf.text },
          isSm ? styles.textSm : styles.textMd,
        ]}
        numberOfLines={1}
      >
        {label || conf.defaultLabel}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderRadius: 9999,
    alignSelf: 'flex-start',
    justifyContent: 'center',
    alignItems: 'center',
  },
  containerSm: {
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  containerMd: {
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  text: {
    fontWeight: '600',
  },
  textSm: {
    fontSize: 11,
    lineHeight: 14,
  },
  textMd: {
    fontSize: 13,
    lineHeight: 18,
  },
});
