import React, { useState } from 'react';
import {
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
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { Card } from '../../components/Card';
import { colors, typography } from '../../constants/theme';

export default function RegisterScreen() {
  const router = useRouter();
  const { registerManager } = useAuth();

  const [storeName, setStoreName] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleRegister = async () => {
    if (!storeName.trim() || !name.trim() || !email.trim() || !password) {
      setErrorMsg('Todos os campos são obrigatórios.');
      return;
    }
    if (password.length < 6) {
      setErrorMsg('A senha deve ter no mínimo 6 caracteres.');
      return;
    }

    setLoading(true);
    setErrorMsg('');
    try {
      const signedIn = await registerManager(storeName.trim(), name.trim(), email.trim(), password);
      if (signedIn) {
        router.replace('/(manager)');
      } else {
        setErrorMsg('Loja criada! Confirme seu e-mail pelo link enviado e depois entre com sua senha.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Falha ao cadastrar loja.');
    } finally {
      setLoading(false);
    }
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
          {/* Header */}
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backBtn}
          >
            <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
            <Text style={styles.backText}>Voltar</Text>
          </TouchableOpacity>

          <View style={styles.titleContainer}>
            <Text style={styles.title}>Cadastre sua Loja</Text>
            <Text style={styles.subtitle}>
              Crie a conta de gerente e configure seu catálogo de produtos.
            </Text>
          </View>

          <Card style={styles.card}>
            {errorMsg ? (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle-outline" size={18} color={colors.danger} />
                <Text style={styles.errorBoxText}>{errorMsg}</Text>
              </View>
            ) : null}

            <Input
              label="Nome da Loja / Unidade"
              placeholder="Ex: Mercadinho Centro"
              value={storeName}
              onChangeText={(val) => {
                setStoreName(val);
                setErrorMsg('');
              }}
              leftIcon={<Ionicons name="business-outline" size={20} color={colors.textMuted} />}
            />

            <Input
              label="Seu Nome (Gerente)"
              placeholder="Ex: Carlos Silva"
              value={name}
              onChangeText={(val) => {
                setName(val);
                setErrorMsg('');
              }}
              leftIcon={<Ionicons name="person-outline" size={20} color={colors.textMuted} />}
            />

            <Input
              label="E-mail de Acesso"
              placeholder="gerente@loja.com"
              keyboardType="email-address"
              autoCapitalize="none"
              value={email}
              onChangeText={(val) => {
                setEmail(val);
                setErrorMsg('');
              }}
              leftIcon={<Ionicons name="mail-outline" size={20} color={colors.textMuted} />}
            />

            <Input
              label="Senha (mínimo 6 dígitos)"
              placeholder="Sua senha secreta"
              secureTextEntry
              value={password}
              onChangeText={(val) => {
                setPassword(val);
                setErrorMsg('');
              }}
              leftIcon={<Ionicons name="lock-closed-outline" size={20} color={colors.textMuted} />}
            />

            <Button
              title="Criar Conta e Começar"
              onPress={handleRegister}
              loading={loading}
              size="lg"
              style={styles.submitBtn}
            />
          </Card>
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
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 32,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  backText: {
    ...typography.bodyStrong,
    marginLeft: 6,
  },
  titleContainer: {
    marginBottom: 24,
  },
  title: {
    ...typography.h1,
  },
  subtitle: {
    ...typography.body,
    marginTop: 4,
  },
  card: {
    padding: 20,
  },
  submitBtn: {
    marginTop: 8,
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
});
