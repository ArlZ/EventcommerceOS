import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    // Nest consumes these constructor class imports at runtime through
    // emitDecoratorMetadata even though they appear as parameter types.
    files: [
      'src/configuration/configuration.controller.ts',
      'src/configuration/configuration.service.ts',
    ],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
];
