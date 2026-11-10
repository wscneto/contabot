import React, { useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { api } from '../../../services/api';
import { useAuth } from '../../../context/AuthContext';
import { Header } from '../../../components/Header';
import { Input } from '../../../components/Input';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { colors, typography } from '../../../constants/theme';

export default function NewProductScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { store } = useAuth();

  const [name, setName] = useState('');
  const [variant, setVariant] = useState('');
  const [barcode, setBarcode] = useState('');
  const [minStock, setMinStock] = useState('');
  const [photoUris, setPhotoUris] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const handlePickFromGallery = async () => {
    if (photoUris.length >= 4) {
      Alert.alert('Limite atingido', 'Você pode adicionar no máximo 4 fotos por produto.');
      return;
    }

    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permissão necessária', 'Permita o acesso à galeria de fotos.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: 4 - photoUris.length,
        quality: 0.9,
      });

      if (!result.canceled && result.assets) {
        const newUris = result.assets.map((a) => a.uri);
        setPhotoUris((prev) => [...prev, ...newUris].slice(0, 4));
      }
    } catch (e: any) {
      Alert.alert('Erro ao selecionar fotos', e.message);
    }
  };

  const handleTakePhoto = async () => {
    if (photoUris.length >= 4) {
      Alert.alert('Limite atingido', 'Você pode adicionar no máximo 4 fotos por produto.');
      return;
    }

    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permissão necessária', 'Permita o acesso à câmera para fotografar a embalagem.');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        quality: 0.9,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        setPhotoUris((prev) => [...prev, result.assets[0].uri].slice(0, 4));
      }
    } catch (e: any) {
      Alert.alert('Erro ao abrir câmera', e.message);
    }
  };

  const handleRemovePhoto = (index: number) => {
    setPhotoUris((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert('Atenção', 'Informe o nome do produto.');
      return;
    }
    if (photoUris.length === 0) {
      Alert.alert('Foto obrigatória', 'Envie pelo menos 1 foto nítida da embalagem para a IA reconhecer o produto.');
      return;
    }

    setSaving(true);
    try {
      if (!store) throw new Error('Sessão expirada. Entre novamente.');
      const parsedMin = minStock.trim() ? Number.parseInt(minStock.trim(), 10) : null;
      if (parsedMin !== null && (!Number.isFinite(parsedMin) || parsedMin < 0)) {
        throw new Error('Estoque mínimo deve ser um número inteiro não negativo.');
      }
      await api.createProduct(store.id, {
        name: name.trim(),
        variant: variant.trim(),
        barcode: barcode.trim(),
        min_stock: parsedMin,
        photoUris,
      });
      queryClient.invalidateQueries({ queryKey: ['manager_products'] });
      queryClient.invalidateQueries({ queryKey: ['manager_dashboard'] });
      router.back();
    } catch (err: any) {
      Alert.alert('Erro ao salvar produto', err.message || 'Falha ao salvar produto.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <Header title="Cadastrar Produto" showBack />

      <ScrollView contentContainerStyle={styles.content}>
        {/* Photo Upload Section */}
        <Text style={styles.sectionHeading}>Fotos de Referência da Embalagem *</Text>
        <Text style={styles.sectionSubtitle}>
          Envie de 1 a 4 fotos nítidas com boa iluminação mostrando a marca, nome e variante.
        </Text>

        <View style={styles.photosGrid}>
          {photoUris.map((uri, idx) => (
            <View key={idx} style={styles.photoThumbWrapper}>
              <Image source={{ uri }} style={styles.photoThumb} contentFit="cover" />
              <TouchableOpacity
                style={styles.removePhotoBtn}
                onPress={() => handleRemovePhoto(idx)}
              >
                <Ionicons name="close" size={14} color="#FFF" />
              </TouchableOpacity>
            </View>
          ))}

          {photoUris.length < 4 && (
            <View style={styles.addPhotoButtonsRow}>
              <TouchableOpacity style={styles.addPhotoBox} onPress={handleTakePhoto}>
                <Ionicons name="camera-outline" size={24} color={colors.primary} />
                <Text style={styles.addPhotoText}>Tirar Foto</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.addPhotoBox} onPress={handlePickFromGallery}>
                <Ionicons name="images-outline" size={24} color={colors.primary} />
                <Text style={styles.addPhotoText}>Galeria</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Form Fields */}
        <Card style={styles.card}>
          <Input
            label="Nome do Produto *"
            placeholder="Ex: Chocolate Ao Leite"
            value={name}
            onChangeText={setName}
            leftIcon={<Ionicons name="cube-outline" size={20} color={colors.textMuted} />}
          />

          <Input
            label="Variante / Gramatura (Opcional)"
            placeholder="Ex: 90g, Barra, Tradicional"
            value={variant}
            onChangeText={setVariant}
            leftIcon={<Ionicons name="pricetag-outline" size={20} color={colors.textMuted} />}
          />

          <Input
            label="Código de Barras / EAN (Opcional)"
            placeholder="Ex: 7891234567890"
            keyboardType="number-pad"
            value={barcode}
            onChangeText={setBarcode}
            leftIcon={<Ionicons name="barcode-outline" size={20} color={colors.textMuted} />}
          />

          <Input
            label="Estoque Mínimo de Alerta (Opcional)"
            placeholder="Ex: 10"
            keyboardType="number-pad"
            value={minStock}
            onChangeText={setMinStock}
            hint="O sistema alertará no painel se a contagem cair abaixo deste valor."
            leftIcon={<Ionicons name="warning-outline" size={20} color={colors.textMuted} />}
          />
        </Card>

        <Button
          title="Salvar Produto no Catálogo"
          onPress={handleSave}
          loading={saving}
          size="lg"
          style={styles.saveBtn}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  sectionHeading: {
    ...typography.h3,
    fontSize: 16,
  },
  sectionSubtitle: {
    ...typography.caption,
    marginTop: 4,
    marginBottom: 14,
    lineHeight: 18,
  },
  photosGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 20,
  },
  photoThumbWrapper: {
    position: 'relative',
  },
  photoThumb: {
    width: 80,
    height: 80,
    borderRadius: 12,
  },
  removePhotoBtn: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: colors.danger,
    width: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addPhotoButtonsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  addPhotoBox: {
    width: 80,
    height: 80,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.surfaceBorderStrong,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  addPhotoText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.primary,
    marginTop: 4,
  },
  card: {
    padding: 18,
    marginBottom: 20,
  },
  saveBtn: {
    marginTop: 6,
  },
});
