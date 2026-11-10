import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { api } from '../services/api';
import { queryClient } from '../services/queryClient';

export interface User {
  id: string;
  name: string;
  role: 'manager' | 'employee';
  email: string | null;
  active: boolean;
  created_at: string;
}

export interface Store {
  id: string;
  name: string;
}

export interface SystemConfig {
  max_video_seconds: number;
}

const DEFAULT_CONFIG: SystemConfig = {
  max_video_seconds: Number(process.env.EXPO_PUBLIC_MAX_VIDEO_SECONDS) || 60,
};

interface AuthContextType {
  user: User | null;
  store: Store | null;
  config: SystemConfig;
  isLoading: boolean;
  loginManager: (email: string, pass: string) => Promise<void>;
  loginEmployee: (code: string) => Promise<void>;
  /** Retorna false quando o projeto exige confirmar o e-mail antes do primeiro login. */
  registerManager: (storeName: string, name: string, email: string, pass: string) => Promise<boolean>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function authMessage(message: string | undefined): string {
  if (!message) return 'Não foi possível entrar. Tente novamente.';
  if (/invalid login credentials/i.test(message)) return 'E-mail ou senha incorretos.';
  if (/email not confirmed/i.test(message)) return 'Confirme seu e-mail antes de entrar.';
  if (/already registered|already exists/i.test(message)) return 'Já existe um usuário cadastrado com este e-mail.';
  if (/password/i.test(message) && /6/.test(message)) return 'A senha deve ter pelo menos 6 caracteres.';
  if (/fetch|network/i.test(message)) return 'Não foi possível conectar ao servidor. Verifique sua conexão.';
  return message;
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [store, setStore] = useState<Store | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const clear = useCallback(() => {
    setUser(null);
    setStore(null);
    queryClient.clear();
  }, []);

  const refreshMe = useCallback(async () => {
    try {
      const data = await api.whoami();
      setUser(data.user);
      setStore(data.store);
    } catch (err) {
      console.warn('Erro ao atualizar usuário atual:', err);
      // Sessão inválida ou perfil desativado: volta para o login.
      await supabase.auth.signOut({ scope: 'local' }).catch(() => null);
      clear();
    }
  }, [clear]);

  useEffect(() => {
    let active = true;
    supabase.auth
      .getSession()
      .then(async ({ data }) => {
        if (data.session) await refreshMe();
      })
      .catch((e) => console.warn('Falha no bootstrap da autenticação:', e))
      .finally(() => active && setIsLoading(false));

    const { data: subscription } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') clear();
    });
    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [refreshMe, clear]);

  const loginManager = async (email: string, pass: string) => {
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password: pass });
      if (error) throw new Error(authMessage(error.message));
      await refreshMe();
    } finally {
      setIsLoading(false);
    }
  };

  const loginEmployee = async (code: string) => {
    setIsLoading(true);
    try {
      const { token_hash } = await api.joinWithCode(code);
      const { error } = await supabase.auth.verifyOtp({ token_hash, type: 'magiclink' });
      if (error) throw new Error(authMessage(error.message));
      await refreshMe();
    } finally {
      setIsLoading(false);
    }
  };

  const registerManager = async (storeName: string, name: string, email: string, pass: string) => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password: pass,
        options: { data: { name: name.trim(), store_name: storeName.trim() } },
      });
      if (error) throw new Error(authMessage(error.message));
      if (!data.session) return false;
      await refreshMe();
      return true;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    setIsLoading(true);
    try {
      await supabase.auth.signOut().catch(() => null);
    } finally {
      clear();
      setIsLoading(false);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        store,
        config: DEFAULT_CONFIG,
        isLoading,
        loginManager,
        loginEmployee,
        registerManager,
        logout,
        refreshMe,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth deve ser usado dentro de um AuthProvider');
  }
  return context;
};
