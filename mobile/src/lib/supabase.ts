// Versões anteriores guardavam a sessão no localStorage do expo-sqlite (sem
// criptografia). O polyfill continua instalado só para migrar essa sessão para o
// SecureStore na primeira leitura; depois a cópia antiga é apagada.
import 'expo-sqlite/localStorage/install';
import { AppState, Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { createClient } from '@supabase/supabase-js';
import { createSecureSessionStorage } from './secure-session-storage';

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

// Em dados móveis uma requisição pode ficar sem resposta para sempre, e a tela
// carregava até o app ser reaberto. Com o limite ela falha e a tela pode tentar de novo.
const REQUEST_TIMEOUT_MS = 30_000;

const fetchWithTimeout: typeof fetch = (input, init) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const callerSignal = init?.signal;
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener('abort', () => controller.abort());
  }
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
};

if (!isSupabaseConfigured) {
  console.warn(
    '[Supabase] Defina EXPO_PUBLIC_SUPABASE_URL e EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY em mobile/.env (veja .env.example).',
  );
}

export const supabase = createClient(supabaseUrl || 'http://127.0.0.1:54321', supabaseKey || 'missing-key', {
  auth: {
    // Web: o SecureStore não existe no navegador; fica o localStorage.
    storage: Platform.OS === 'web' ? localStorage : createSecureSessionStorage(SecureStore, localStorage),
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  global: { fetch: fetchWithTimeout },
});

// Renova o token só com o app em primeiro plano (recomendação do guia Expo + Supabase).
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
