import React from 'react';
import { Stack } from 'expo-router';
import { colors } from '../../constants/theme';

export default function EmployeeLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="task/[id]/index" />
      <Stack.Screen name="task/[id]/camera" options={{ presentation: 'fullScreenModal' }} />
      <Stack.Screen name="task/[id]/analyzing" options={{ gestureEnabled: false }} />
      <Stack.Screen name="task/[id]/review" />
    </Stack>
  );
}
