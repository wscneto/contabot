import 'expo-sqlite/localStorage/install';
import { AppState, Platform } from 'react-native';
import { createClient } from '@supabase/supabase-js';

export const getSupabaseUrl = (): string => {
  const envUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
  if (envUrl.startsWith('https://')) {
    return envUrl;
  }
  // No navegador web no próprio computador (localhost / 127.0.0.1), usa localhost direto
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location) {
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      return `${window.location.protocol}//${window.location.hostname}:54321`;
    }
  }
  return envUrl || 'http://127.0.0.1:54321';
};

export const supabaseUrl = getSupabaseUrl();
const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey);

if (!isSupabaseConfigured) {
  console.warn(
    '[Supabase] Defina EXPO_PUBLIC_SUPABASE_URL e EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY em mobile/.env (veja .env.example).',
  );
}

export const supabase = createClient(supabaseUrl || 'http://127.0.0.1:54321', supabaseKey || 'missing-key', {
  auth: {
    storage: localStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Renova o token só com o app em primeiro plano (recomendação do guia Expo + Supabase).
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
