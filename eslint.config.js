// eslint.config.js
const expoConfig = require('eslint-config-expo/flat');

module.exports = [
  ...expoConfig,
  {
    rules: {
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/purity': 'off',
    },
  },
  {
    ignores: [
      'android/**',
      'ios/**',
      'node_modules/**',
      'WORKSPACE/**',
      'dist/**',
      'build/**',
      'scripts/**',
      'tests/**',
      'modules/**',
      'plugins/**',
      '*.config.js',
    ],
  },
];
