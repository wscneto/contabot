// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'coverage/*'],
  },
  {
    rules: {
      // Telas de edição copiam dados do servidor para o estado do formulário em um
      // useEffect. Mantido como aviso (e não erro) até essas telas serem refatoradas.
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
]);
