import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, type GestureResponderEvent } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../constants/theme';

interface ExportCsvButtonProps {
  loading?: boolean;
  onPress: () => void;
}

export function ExportCsvButton({ loading = false, onPress }: ExportCsvButtonProps) {
  const handlePress = (e: GestureResponderEvent) => {
    e.stopPropagation?.();
    onPress();
  };

  return (
    <TouchableOpacity style={styles.button} disabled={loading} onPress={handlePress}>
      {loading ? (
        <ActivityIndicator size="small" color={colors.primary} />
      ) : (
        <Ionicons name="download-outline" size={16} color={colors.primary} />
      )}
      <Text style={styles.label}>Exportar CSV</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: colors.primaryLight,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primaryDark,
  },
});
