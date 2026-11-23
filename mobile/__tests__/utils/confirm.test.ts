import { Alert, Platform } from 'react-native';
import { confirmAction, showMessage } from '@/utils/confirm';

type AlertButtons = Parameters<typeof Alert.alert>[2];

describe('utils/confirm', () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** Botões passados na última chamada de Alert.alert. */
  const lastButtons = (): NonNullable<AlertButtons> => alertSpy.mock.calls.at(-1)[2];

  describe('nativo (iOS/Android)', () => {
    test.each(['ios', 'android'] as const)('confirmAction usa Alert.alert com Cancelar/OK em %s', (os) => {
      jest.replaceProperty(Platform, 'OS', os);
      const onConfirm = jest.fn();
      confirmAction('Excluir', 'Tem certeza?', onConfirm);

      expect(alertSpy).toHaveBeenCalledTimes(1);
      expect(alertSpy.mock.calls[0][0]).toBe('Excluir');
      expect(alertSpy.mock.calls[0][1]).toBe('Tem certeza?');
      expect(lastButtons()).toEqual([
        { text: 'Cancelar', style: 'cancel' },
        { text: 'OK', style: 'default', onPress: expect.any(Function) },
      ]);
      // Nada acontece até a pessoa tocar no botão
      expect(onConfirm).not.toHaveBeenCalled();
    });

    test('confirmAction executa onConfirm só ao tocar em confirmar', () => {
      jest.replaceProperty(Platform, 'OS', 'ios');
      const onConfirm = jest.fn();
      confirmAction('Título', 'Mensagem', onConfirm);

      const [cancel, confirm] = lastButtons();
      expect(cancel.onPress).toBeUndefined();
      confirm.onPress?.();
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    test('confirmAction aceita textos customizados e estilo destrutivo', () => {
      jest.replaceProperty(Platform, 'OS', 'android');
      confirmAction('Remover', 'Remover funcionário?', jest.fn(), {
        confirmText: 'Remover',
        cancelText: 'Voltar',
        destructive: true,
      });
      expect(lastButtons()).toEqual([
        { text: 'Voltar', style: 'cancel' },
        { text: 'Remover', style: 'destructive', onPress: expect.any(Function) },
      ]);
    });

    test('showMessage mostra um único botão OK e chama onClose ao tocar/dispensar', () => {
      jest.replaceProperty(Platform, 'OS', 'ios');
      const onClose = jest.fn();
      showMessage('Pronto', 'Produtos importados', onClose);

      expect(alertSpy).toHaveBeenCalledWith('Pronto', 'Produtos importados', [{ text: 'OK', onPress: onClose }], {
        cancelable: true,
        onDismiss: onClose,
      });
    });

    test('showMessage sem onClose não é cancelável', () => {
      jest.replaceProperty(Platform, 'OS', 'android');
      showMessage('Erro', 'Algo deu errado');
      expect(alertSpy).toHaveBeenCalledWith('Erro', 'Algo deu errado', [{ text: 'OK', onPress: undefined }], {
        cancelable: false,
        onDismiss: undefined,
      });
    });
  });

  describe('web', () => {
    const originalConfirm = window.confirm;
    const originalAlert = window.alert;

    beforeEach(() => {
      jest.replaceProperty(Platform, 'OS', 'web');
    });

    afterEach(() => {
      window.confirm = originalConfirm;
      window.alert = originalAlert;
    });

    test('confirmAction usa window.confirm e executa onConfirm quando aceito', () => {
      window.confirm = jest.fn(() => true);
      const onConfirm = jest.fn();
      confirmAction('Excluir', 'Tem certeza?', onConfirm);

      expect(window.confirm).toHaveBeenCalledWith('Excluir\n\nTem certeza?');
      expect(onConfirm).toHaveBeenCalledTimes(1);
      expect(alertSpy).not.toHaveBeenCalled();
    });

    test('confirmAction não executa onConfirm quando cancelado', () => {
      window.confirm = jest.fn(() => false);
      const onConfirm = jest.fn();
      confirmAction('Excluir', 'Tem certeza?', onConfirm);
      expect(onConfirm).not.toHaveBeenCalled();
    });

    test('showMessage usa window.alert e chama onClose depois', () => {
      const order: string[] = [];
      window.alert = jest.fn(() => order.push('alert'));
      const onClose = jest.fn(() => order.push('close'));
      showMessage('Aviso', 'Mensagem', onClose);

      expect(window.alert).toHaveBeenCalledWith('Aviso\n\nMensagem');
      expect(order).toEqual(['alert', 'close']);
      expect(alertSpy).not.toHaveBeenCalled();
    });

    test('showMessage sem onClose apenas alerta', () => {
      window.alert = jest.fn();
      expect(() => showMessage('Aviso', 'Mensagem')).not.toThrow();
      expect(window.alert).toHaveBeenCalledTimes(1);
    });
  });
});
