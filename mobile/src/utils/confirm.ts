import { Alert, Platform } from 'react-native';

interface ConfirmOptions {
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
}

/**
 * Diálogo de confirmação multiplataforma.
 * `Alert.alert` com botões não faz nada no react-native-web, então na web
 * usamos `window.confirm`.
 */
export function confirmAction(
  title: string,
  message: string,
  onConfirm: () => void | Promise<void>,
  { confirmText = 'OK', cancelText = 'Cancelar', destructive = false }: ConfirmOptions = {},
) {
  if (Platform.OS === 'web') {
    if (window.confirm(`${title}\n\n${message}`)) {
      void onConfirm();
    }
    return;
  }

  Alert.alert(title, message, [
    { text: cancelText, style: 'cancel' },
    {
      text: confirmText,
      style: destructive ? 'destructive' : 'default',
      onPress: () => void onConfirm(),
    },
  ]);
}
