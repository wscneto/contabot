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
    </Stack>
  );
}
