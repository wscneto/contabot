import React from 'react';
import {
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../constants/theme';

interface StepperProps {
  value: number | null;
  onChange: (newValue: number | null) => void;
  min?: number;
  max?: number;
  style?: ViewStyle;
}

export const Stepper: React.FC<StepperProps> = ({
  value,
  onChange,
  min = 0,
  max = 99999,
  style,
}) => {
  const triggerHaptic = () => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => null);
    }
  };

  const handleDecrement = () => {
    triggerHaptic();
    if (value === null) {
      onChange(min);
    } else if (value > min) {
      onChange(value - 1);
    }
  };

  const handleIncrement = () => {
    triggerHaptic();
    if (value === null) {
      onChange(1);
    } else if (value < max) {
      onChange(value + 1);
    }
  };

  const handleTextChange = (text: string) => {
    const clean = text.trim();
    if (clean === '') {
      onChange(null);
      return;
    }
    const num = parseInt(clean, 10);
    if (!isNaN(num) && num >= min && num <= max) {
      onChange(num);
    }
  };

  return (
    <View style={[styles.container, style]}>
      <TouchableOpacity
        onPress={handleDecrement}
        style={[styles.button, value !== null && value <= min && styles.buttonDisabled]}
        disabled={value !== null && value <= min}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityLabel="Diminuir quantidade"
      >
        <Ionicons name="remove" size={20} color={colors.textPrimary} />
      </TouchableOpacity>

      <View style={styles.inputContainer}>
        <TextInput
          style={[styles.input, value === null && styles.inputEmpty]}
          keyboardType="number-pad"
          value={value === null ? '' : String(value)}
          placeholder="—"
          placeholderTextColor={colors.textMuted}
          onChangeText={handleTextChange}
          selectTextOnFocus
          maxLength={5}
        />
      </View>

      <TouchableOpacity
        onPress={handleIncrement}
        style={[styles.button, value !== null && value >= max && styles.buttonDisabled]}
        disabled={value !== null && value >= max}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityLabel="Aumentar quantidade"
      >
        <Ionicons name="add" size={20} color={colors.textPrimary} />
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceSubtle,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    padding: 3,
  },
  button: {
    width: 38,
    height: 38,
    borderRadius: 9,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  buttonDisabled: {
    opacity: 0.35,
  },
  inputContainer: {
    // Largura fixa: no Android o TextInput cresce com o conteúdo e empurra o "+" para fora.
    width: 60,
    paddingHorizontal: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  input: {
    width: '100%',
    paddingHorizontal: 0,
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
    textAlign: 'center',
    paddingVertical: 2,
    minHeight: 34,
  },
  inputEmpty: {
    color: colors.textMuted,
  },
});
