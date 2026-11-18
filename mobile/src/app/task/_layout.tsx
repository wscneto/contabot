import React from 'react';
import { Stack } from 'expo-router';
import { colors } from '../../constants/theme';

// Fluxo de contagem compartilhado: funcionários e gerentes filmam, analisam e
// conferem pelas mesmas telas. A diferença fica só no final da conferência.
export default function TaskFlowLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="[id]/index" />
      <Stack.Screen name="[id]/camera" options={{ presentation: 'fullScreenModal' }} />
      <Stack.Screen name="[id]/analyzing" options={{ gestureEnabled: false }} />
      <Stack.Screen name="[id]/review" />
    </Stack>
  );
}
