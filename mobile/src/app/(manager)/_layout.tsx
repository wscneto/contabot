import React from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../constants/theme';

export default function ManagerLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.surfaceBorder,
          height: 60,
          paddingBottom: 8,
          paddingTop: 6,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Início',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="grid-outline" size={size} color={color as string} />
          ),
        }}
      />
      <Tabs.Screen
        name="tasks"
        options={{
          title: 'Contagens',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="clipboard-outline" size={size} color={color as string} />
          ),
        }}
      />
      <Tabs.Screen
        name="products"
        options={{
          title: 'Produtos',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="cube-outline" size={size} color={color as string} />
          ),
        }}
      />
      <Tabs.Screen
        name="areas"
        options={{
          title: 'Áreas',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="map-outline" size={size} color={color as string} />
          ),
        }}
      />
      <Tabs.Screen
        name="team"
        options={{
          title: 'Equipe',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="people-outline" size={size} color={color as string} />
          ),
        }}
      />
    </Tabs>
  );
}
