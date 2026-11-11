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

/**
 * Aviso com um único botão. Na web `Alert.alert` não exibe nada, então usamos
 * `window.alert`; `onClose` roda depois que a pessoa fecha o aviso.
 */
export function showMessage(title: string, message: string, onClose?: () => void) {
  if (Platform.OS === 'web') {
    window.alert(`${title}\n\n${message}`);
    onClose?.();
    return;
  }
  Alert.alert(title, message, [{ text: 'OK', onPress: onClose }], {
    cancelable: Boolean(onClose),
    onDismiss: onClose,
  });
}
