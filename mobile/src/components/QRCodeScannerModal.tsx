import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  initialWindowMetrics,
  SafeAreaProvider,
  SafeAreaView,
} from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { parseAccessCodeFromQr } from '../utils/qr-access-code';
import { Button } from './Button';
import { colors } from '../constants/theme';

interface QRCodeScannerModalProps {
  visible: boolean;
  onClose: () => void;
  onCodeScanned: (code: string) => void;
}

function ScannerContent({ onClose, onCodeScanned }: Omit<QRCodeScannerModalProps, 'visible'>) {
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [scanError, setScanError] = useState('');
  const scannedRef = useRef(false);

  if (Platform.OS === 'web') {
    return (
      <SafeAreaView style={styles.permissionContainer}>
        <Ionicons name="qr-code-outline" size={64} color={colors.primary} />
        <Text style={styles.permissionTitle}>Leitura de QR no App Mobile</Text>
        <Text style={styles.permissionSubtitle}>
          No navegador, digite o código de acesso de 8 dígitos informado pelo gerente.
        </Text>
        <Button title="Fechar" onPress={onClose} size="lg" style={styles.permissionBtn} />
      </SafeAreaView>
    );
  }

  if (!permission) {
    return (
      <SafeAreaView style={styles.permissionContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </SafeAreaView>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.permissionContainer}>
        <Ionicons name="camera-outline" size={64} color={colors.primary} />
        <Text style={styles.permissionTitle}>Permissão de Câmera Necessária</Text>
        <Text style={styles.permissionSubtitle}>
          Permita o acesso à câmera para escanear o QR Code de convite gerado pelo gerente da loja.
        </Text>
        <Button
          title="Permitir Acesso à Câmera"
          onPress={() => {
            void requestPermission();
          }}
          size="lg"
          style={styles.permissionBtn}
        />
        <Button
          title="Digitar código manualmente"
          onPress={onClose}
          variant="outline"
          style={styles.permissionBtn}
        />
      </SafeAreaView>
    );
  }

  const handleBarcodeScanned = (result: BarcodeScanningResult) => {
    if (scannedRef.current) return;
    const code = parseAccessCodeFromQr(result.data);
    if (!code) {
      setScanError('QR Code não reconhecido. Aponte para o convite do ContaBot.');
      return;
    }
    scannedRef.current = true;
    setScanError('');
    onCodeScanned(code);
  };

  return (
    <View style={styles.cameraContainer}>
      <CameraView
        style={styles.camera}
        facing="back"
        enableTorch={torch}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={handleBarcodeScanned}
      />

      <View style={styles.overlay} pointerEvents="box-none" collapsable={false}>
        <SafeAreaView style={styles.topBar} edges={['top', 'left', 'right']}>
          <TouchableOpacity
            onPress={onClose}
            style={styles.iconCircle}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Fechar leitor de QR Code"
          >
            <Ionicons name="close" size={24} color="#FFF" />
          </TouchableOpacity>

          <View style={styles.titlePill}>
            <Text style={styles.titlePillText}>Escanear Convite</Text>
          </View>

          <TouchableOpacity
            onPress={() => setTorch((prev) => !prev)}
            style={[styles.iconCircle, torch && styles.iconCircleActive]}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={torch ? 'Desligar lanterna' : 'Ligar lanterna'}
          >
            <Ionicons name={torch ? 'flash' : 'flash-off'} size={22} color="#FFF" />
          </TouchableOpacity>
        </SafeAreaView>

        <View style={styles.frameContainer} pointerEvents="none">
          <View style={styles.frameBox}>
            <View style={[styles.corner, styles.cornerTL]} />
            <View style={[styles.corner, styles.cornerTR]} />
            <View style={[styles.corner, styles.cornerBL]} />
            <View style={[styles.corner, styles.cornerBR]} />
          </View>

          <View style={[styles.hintPill, scanError ? styles.hintPillError : undefined]}>
            <Text style={styles.hintText}>
              {scanError || 'Aponte a câmera para o QR Code exibido pelo gerente'}
            </Text>
          </View>
        </View>

        <SafeAreaView style={styles.bottomBar} edges={['bottom', 'left', 'right']}>
          <TouchableOpacity onPress={onClose} style={styles.manualBtn}>
            <Ionicons name="keypad-outline" size={18} color="#FFF" />
            <Text style={styles.manualBtnText}>Digitar código manualmente</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </View>
    </View>
  );
}

const FALLBACK_SAFE_AREA_METRICS = {
  frame: { x: 0, y: 0, width: 0, height: 0 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

export const QRCodeScannerModal: React.FC<QRCodeScannerModalProps> = ({
  visible,
  onClose,
  onCodeScanned,
}) => {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      {visible ? (
        <SafeAreaProvider initialMetrics={initialWindowMetrics ?? FALLBACK_SAFE_AREA_METRICS}>
          <ScannerContent onClose={onClose} onCodeScanned={onCodeScanned} />
        </SafeAreaProvider>
      ) : null}
    </Modal>
  );
};

const styles = StyleSheet.create({
  cameraContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  camera: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 1,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconCircleActive: {
    backgroundColor: colors.primary,
  },
  titlePill: {
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  titlePillText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '700',
  },
  frameContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  frameBox: {
    width: 240,
    height: 240,
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderColor: colors.primaryLight,
  },
  cornerTL: {
    top: 0,
    left: 0,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderTopLeftRadius: 8,
  },
  cornerTR: {
    top: 0,
    right: 0,
    borderTopWidth: 4,
    borderRightWidth: 4,
    borderTopRightRadius: 8,
  },
  cornerBL: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderBottomLeftRadius: 8,
  },
  cornerBR: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderBottomRightRadius: 8,
  },
  hintPill: {
    marginTop: 24,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 16,
    maxWidth: 300,
  },
  hintPillError: {
    backgroundColor: 'rgba(153, 27, 27, 0.9)',
  },
  hintText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 18,
  },
  bottomBar: {
    paddingHorizontal: 20,
    paddingBottom: 24,
    alignItems: 'center',
  },
  manualBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
  },
  manualBtnText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '600',
  },
  permissionContainer: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 30,
  },
  permissionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.textPrimary,
    marginTop: 20,
    marginBottom: 8,
    textAlign: 'center',
  },
  permissionSubtitle: {
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 28,
    lineHeight: 22,
  },
  permissionBtn: {
    width: '100%',
    marginBottom: 12,
  },
});
