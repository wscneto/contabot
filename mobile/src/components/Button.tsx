import React from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { colors, shadows, typography } from '../constants/theme';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost';

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
  iconRight?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  textStyle?: TextStyle;
  size?: 'sm' | 'md' | 'lg';
}

export const Button: React.FC<ButtonProps> = ({
  title,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  icon,
  iconRight,
  style,
  textStyle,
  size = 'md',
}) => {
  const handlePress = () => {
    if (disabled || loading) return;
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => null);
    }
    onPress();
  };

  const getVariantStyles = (): { btn: ViewStyle; text: TextStyle } => {
    switch (variant) {
      case 'secondary':
        return {
          btn: { backgroundColor: colors.secondary, borderColor: colors.secondary },
          text: { color: colors.textInverse },
        };
      case 'outline':
        return {
          btn: { backgroundColor: 'transparent', borderColor: colors.surfaceBorderStrong, borderWidth: 1.5 },
          text: { color: colors.textPrimary },
        };
      case 'danger':
        return {
          btn: { backgroundColor: colors.danger, borderColor: colors.danger },
          text: { color: colors.textInverse },
        };
      case 'ghost':
        return {
          btn: { backgroundColor: 'transparent', borderColor: 'transparent' },
          text: { color: colors.primary },
        };
      case 'primary':
      default:
        return {
          btn: { backgroundColor: colors.primary, borderColor: colors.primary },
          text: { color: colors.textInverse },
        };
    }
  };

  const getSizeStyles = (): { btn: ViewStyle; text: TextStyle } => {
    switch (size) {
      case 'sm':
        return {
          btn: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8 },
          text: { fontSize: 13, lineHeight: 18 },
        };
      case 'lg':
        return {
          btn: { paddingVertical: 16, paddingHorizontal: 24, borderRadius: 14 },
          text: { fontSize: 17, lineHeight: 22, fontWeight: '700' },
        };
      case 'md':
      default:
        return {
          btn: { paddingVertical: 12, paddingHorizontal: 18, borderRadius: 10 },
          text: { fontSize: 15, lineHeight: 20 },
        };
    }
  };

  const vStyles = getVariantStyles();
  const sStyles = getSizeStyles();

  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.base,
        vStyles.btn,
        sStyles.btn,
        variant !== 'ghost' && variant !== 'outline' && shadows.sm,
        disabled && styles.disabled,
        pressed && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={vStyles.text.color} size="small" />
      ) : (
        <>
          {icon && <View style={styles.iconLeft}>{icon}</View>}
          <Text style={[styles.text, vStyles.text, sStyles.text, textStyle]}>{title}</Text>
          {iconRight && <View style={styles.iconRight}>{iconRight}</View>}
        </>
      )}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    minHeight: 44,
  },
  text: {
    ...typography.button,
    textAlign: 'center',
  },
  disabled: {
    opacity: 0.5,
  },
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  iconLeft: {
    marginRight: 8,
  },
  iconRight: {
    marginLeft: 8,
  },
});
