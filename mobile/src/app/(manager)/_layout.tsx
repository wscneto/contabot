import React from 'react';
import { Stack } from 'expo-router';
import { colors } from '../../constants/theme';

export default function ManagerLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="products/new" options={{ headerShown: false }} />
      <Stack.Screen name="areas/new" options={{ headerShown: false }} />
      <Stack.Screen name="tasks/new" options={{ headerShown: false }} />
      <Stack.Screen name="tasks/[id]" options={{ headerShown: false }} />
    </Stack>
  );
}
