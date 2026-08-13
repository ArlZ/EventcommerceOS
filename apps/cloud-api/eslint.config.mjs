import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    files: ['src/**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
];
