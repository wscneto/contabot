import React from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography } from '../constants/theme';
import { Button } from './Button';

interface QRCodeModalProps {
  visible: boolean;
  onClose: () => void;
  memberName: string;
  accessCode: string;
}

export const QRCodeModal: React.FC<QRCodeModalProps> = ({
  visible,
  onClose,
  memberName,
  accessCode,
}) => {
  // O app já sabe qual projeto Supabase usar; o QR carrega só o código.
  const qrData = JSON.stringify({ code: accessCode });

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <Text style={styles.title}>Convite para Equipe</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <Text style={styles.desc}>
            Peça para <Text style={styles.bold}>{memberName}</Text> abrir o app ContaBot e escanear este código ou digitar o código de acesso abaixo.
          </Text>

          <View style={styles.qrContainer}>
            <QRCode
              value={qrData}
              size={200}
              backgroundColor={colors.surface}
              color={colors.textPrimary}
            />
          </View>

          <View style={styles.codeBox}>
            <Text style={styles.codeLabel}>CÓDIGO DE ACESSO</Text>
            <Text style={styles.codeText}>{accessCode}</Text>
          </View>

          <Button
            title="Concluído"
            onPress={onClose}
            variant="outline"
            style={styles.doneBtn}
          />
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 380,
    alignItems: 'center',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    marginBottom: 12,
  },
  title: {
    ...typography.h2,
    fontSize: 20,
  },
  closeBtn: {
    padding: 4,
  },
  desc: {
    ...typography.body,
    textAlign: 'center',
    marginBottom: 20,
  },
  bold: {
    fontWeight: '700',
    color: colors.textPrimary,
  },
  qrContainer: {
    padding: 16,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    marginBottom: 20,
  },
  codeBox: {
    backgroundColor: colors.surfaceSubtle,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 20,
    alignItems: 'center',
    width: '100%',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  codeLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
    letterSpacing: 1,
    marginBottom: 4,
  },
  codeText: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.primary,
    letterSpacing: 3,
  },
  doneBtn: {
    width: '100%',
  },
});
