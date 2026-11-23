import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { storage } from '@/services/storage';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const secure = SecureStore as jest.Mocked<typeof SecureStore>;

describe('services/storage', () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  describe('nativo (SecureStore)', () => {
    beforeEach(() => jest.replaceProperty(Platform, 'OS', 'android'));

    test('getItem lê do SecureStore', async () => {
      secure.getItemAsync.mockResolvedValueOnce('valor');
      await expect(storage.getItem('chave')).resolves.toBe('valor');
      expect(secure.getItemAsync).toHaveBeenCalledWith('chave');
    });

    test('getItem devolve null se o SecureStore falhar (ex.: keystore corrompido)', async () => {
      secure.getItemAsync.mockRejectedValueOnce(new Error('keystore'));
      await expect(storage.getItem('chave')).resolves.toBeNull();
    });

    test('setItem e removeItem delegam ao SecureStore', async () => {
      await storage.setItem('k', 'v');
      await storage.removeItem('k');
      expect(secure.setItemAsync).toHaveBeenCalledWith('k', 'v');
      expect(secure.deleteItemAsync).toHaveBeenCalledWith('k');
    });

    test('setItem/removeItem não propagam erro, só registram aviso', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      secure.setItemAsync.mockRejectedValueOnce(new Error('cheio'));
      secure.deleteItemAsync.mockRejectedValueOnce(new Error('falhou'));
      await expect(storage.setItem('k', 'v')).resolves.toBeUndefined();
      await expect(storage.removeItem('k')).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledTimes(2);
    });
  });

  describe('web (localStorage)', () => {
    const store = new Map<string, string>();
    const fakeLocalStorage = {
      getItem: jest.fn((k: string) => store.get(k) ?? null),
      setItem: jest.fn((k: string, v: string) => void store.set(k, v)),
      removeItem: jest.fn((k: string) => void store.delete(k)),
    };
    let original: PropertyDescriptor | undefined;

    beforeEach(() => {
      jest.replaceProperty(Platform, 'OS', 'web');
      store.clear();
      original = Object.getOwnPropertyDescriptor(window, 'localStorage');
      Object.defineProperty(window, 'localStorage', { value: fakeLocalStorage, configurable: true });
    });

    afterEach(() => {
      if (original) Object.defineProperty(window, 'localStorage', original);
      else delete (window as { localStorage?: unknown }).localStorage;
    });

    test('grava, lê e remove pelo localStorage sem tocar no SecureStore', async () => {
      await storage.setItem('sessao', 'abc');
      await expect(storage.getItem('sessao')).resolves.toBe('abc');
      await storage.removeItem('sessao');
      await expect(storage.getItem('sessao')).resolves.toBeNull();
      expect(secure.setItemAsync).not.toHaveBeenCalled();
      expect(secure.getItemAsync).not.toHaveBeenCalled();
    });

    test('localStorage indisponível (modo privado) não quebra', async () => {
      Object.defineProperty(window, 'localStorage', { value: undefined, configurable: true });
      await expect(storage.getItem('x')).resolves.toBeNull();
      await expect(storage.setItem('x', 'y')).resolves.toBeUndefined();
      await expect(storage.removeItem('x')).resolves.toBeUndefined();
    });

    test('getItem devolve null se o localStorage lançar (SecurityError)', async () => {
      fakeLocalStorage.getItem.mockImplementationOnce(() => {
        throw new Error('SecurityError');
      });
      await expect(storage.getItem('x')).resolves.toBeNull();
    });
  });
});
