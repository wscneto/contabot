import React, { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { isSupabaseConfigured } from '../../lib/supabase';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { Card } from '../../components/Card';
import { colors, typography } from '../../constants/theme';

export default function LoginScreen() {
  const router = useRouter();
  const { loginManager, loginEmployee } = useAuth();

  const [roleTab, setRoleTab] = useState<'employee' | 'manager'>('employee');

  // Employee fields
  const [accessCode, setAccessCode] = useState('');

  // Manager fields
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleEmployeeLogin = async () => {
    if (!accessCode.trim()) {
      setErrorMsg('Informe o código de acesso recebido do gerente.');
      return;
    }
    setLoading(true);
    setErrorMsg('');
    try {
      await loginEmployee(accessCode.trim());
      router.replace('/(employee)');
    } catch (err: any) {
      setErrorMsg(err.message || 'Código de acesso incorreto.');
    } finally {
      setLoading(false);
    }
  };

  const handleManagerLogin = async () => {
    if (!email.trim() || !password) {
      setErrorMsg('Preencha seu e-mail e senha.');
      return;
    }
    setLoading(true);
    setErrorMsg('');
    try {
      await loginManager(email.trim(), password);
      router.replace('/(manager)');
    } catch (err: any) {
      setErrorMsg(err.message || 'E-mail ou senha incorretos.');
    } finally {
      setLoading(false);
    }
  };

  const fillAnaDemo = () => {
    setAccessCode('ANA1-2345');
    setErrorMsg('');
  };

  const fillCarlaDemo = () => {
    setEmail('demo@contabot.app');
    setPassword('contabot');
    setErrorMsg('');
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContainer}
          keyboardShouldPersistTaps="handled"
        >
          {/* Logo & Header */}
          <View style={styles.brandContainer}>
            <View style={styles.logoBadge}>
              <Ionicons name="scan-outline" size={32} color={colors.primary} />
            </View>
            <Text style={styles.appName}>ContaBot</Text>
            <Text style={styles.tagline}>
              Contagem de estoque visual por vídeo
            </Text>
          </View>

          {/* Role selector tabs */}
          <View style={styles.tabContainer}>
            <TouchableOpacity
              onPress={() => {
                setRoleTab('employee');
                setErrorMsg('');
              }}
              style={[styles.tab, roleTab === 'employee' && styles.tabActive]}
            >
              <Ionicons
                name="person-outline"
                size={18}
                color={roleTab === 'employee' ? colors.primary : colors.textMuted}
                style={styles.tabIcon}
              />
              <Text
                style={[
                  styles.tabText,
                  roleTab === 'employee' && styles.tabTextActive,
                ]}
              >
                Funcionário
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => {
                setRoleTab('manager');
                setErrorMsg('');
              }}
              style={[styles.tab, roleTab === 'manager' && styles.tabActive]}
            >
              <Ionicons
                name="business-outline"
                size={18}
                color={roleTab === 'manager' ? colors.primary : colors.textMuted}
                style={styles.tabIcon}
              />
              <Text
                style={[
                  styles.tabText,
                  roleTab === 'manager' && styles.tabTextActive,
                ]}
              >
                Gerente
              </Text>
            </TouchableOpacity>
          </View>

          {/* Form Card */}
          <Card style={styles.formCard}>
            {errorMsg ? (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle-outline" size={18} color={colors.danger} />
                <Text style={styles.errorBoxText}>{errorMsg}</Text>
              </View>
            ) : null}

            {roleTab === 'employee' ? (
              <View>
                <Text style={styles.sectionTitle}>Entrar com Código</Text>
                <Text style={styles.sectionSubtitle}>
                  Digite o código de 8 dígitos gerado pelo gerente da sua loja.
                </Text>

                <Input
                  label="Código de Acesso"
                  placeholder="Ex: ANA1-2345"
                  value={accessCode}
                  onChangeText={(val) => {
                    setAccessCode(val.toUpperCase());
                    setErrorMsg('');
                  }}
                  autoCapitalize="characters"
                  maxLength={10}
                  leftIcon={
                    <Ionicons name="key-outline" size={20} color={colors.textMuted} />
                  }
                  style={styles.codeInput}
                />

                <Button
                  title="Acessar Contagens"
                  onPress={handleEmployeeLogin}
                  loading={loading}
                  size="lg"
                  style={styles.submitBtn}
                />

                {/* Quick Demo Helper */}
                <TouchableOpacity
                  onPress={fillAnaDemo}
                  style={styles.demoPill}
                >
                  <Ionicons name="flash-outline" size={15} color={colors.primary} />
                  <Text style={styles.demoPillText}>Preencher Demo: Ana Balcão</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View>
                <Text style={styles.sectionTitle}>Painel do Gerente</Text>
                <Text style={styles.sectionSubtitle}>
                  Acesse com seu e-mail e senha para gerenciar produtos, áreas e aprovações.
                </Text>

                <Input
                  label="E-mail"
                  placeholder="seu@email.com"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  value={email}
                  onChangeText={(val) => {
                    setEmail(val);
                    setErrorMsg('');
                  }}
                  leftIcon={
                    <Ionicons name="mail-outline" size={20} color={colors.textMuted} />
                  }
                />

                <Input
                  label="Senha"
                  placeholder="Sua senha"
                  secureTextEntry
                  value={password}
                  onChangeText={(val) => {
                    setPassword(val);
                    setErrorMsg('');
                  }}
                  leftIcon={
                    <Ionicons name="lock-closed-outline" size={20} color={colors.textMuted} />
                  }
                />

                <Button
                  title="Entrar como Gerente"
                  onPress={handleManagerLogin}
                  loading={loading}
                  size="lg"
                  style={styles.submitBtn}
                />

                {/* Quick Demo Helper */}
                <TouchableOpacity
                  onPress={fillCarlaDemo}
                  style={styles.demoPill}
                >
                  <Ionicons name="flash-outline" size={15} color={colors.primary} />
                  <Text style={styles.demoPillText}>Preencher Demo: Carla Gerente</Text>
                </TouchableOpacity>

                <View style={styles.registerRow}>
                  <Text style={styles.registerHint}>Não tem uma conta?</Text>
                  <TouchableOpacity onPress={() => router.push('/(auth)/register')}>
                    <Text style={styles.registerLink}>Cadastrar nova loja</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </Card>

          {!isSupabaseConfigured && (
            <View style={styles.serverFooter}>
              <Ionicons name="warning-outline" size={14} color={colors.dangerText} />
              <Text style={styles.serverText}>
                Supabase não configurado: defina EXPO_PUBLIC_SUPABASE_URL e EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY em mobile/.env.
              </Text>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  keyboardView: {
    flex: 1,
  },
  scrollContainer: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 32,
    justifyContent: 'center',
  },
  brandContainer: {
    alignItems: 'center',
    marginBottom: 24,
  },
  logoBadge: {
    width: 64,
    height: 64,
    borderRadius: 18,
    backgroundColor: colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  appName: {
    ...typography.h1,
    color: colors.textPrimary,
  },
  tagline: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 4,
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceSubtle,
    borderRadius: 12,
    padding: 4,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
  },
  tabActive: {
    backgroundColor: colors.surface,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 2,
  },
  tabIcon: {
    marginRight: 6,
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textMuted,
  },
  tabTextActive: {
    color: colors.textPrimary,
  },
  formCard: {
    padding: 20,
  },
  sectionTitle: {
    ...typography.h2,
    fontSize: 18,
    marginBottom: 4,
  },
  sectionSubtitle: {
    ...typography.caption,
    marginBottom: 20,
  },
  codeInput: {
    letterSpacing: 2,
    fontWeight: '700',
    fontSize: 17,
  },
  submitBtn: {
    marginTop: 8,
  },
  demoPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryLight,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    alignSelf: 'center',
    marginTop: 16,
  },
  demoPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.primaryDark,
    marginLeft: 6,
  },
  registerRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 20,
  },
  registerHint: {
    ...typography.body,
    fontSize: 14,
    marginRight: 6,
  },
  registerLink: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.primary,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.dangerBg,
    borderRadius: 8,
    padding: 10,
    marginBottom: 16,
  },
  errorBoxText: {
    fontSize: 13,
    color: colors.dangerText,
    marginLeft: 8,
    flex: 1,
  },
  serverFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
    paddingVertical: 8,
  },
  serverText: {
    fontSize: 12,
    color: colors.textMuted,
    marginHorizontal: 8,
    maxWidth: 280,
  },
});
