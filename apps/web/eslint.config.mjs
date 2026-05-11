import nextPlugin from '@next/eslint-plugin-next';

import { nextConfig as baseNext } from '@envstore/config/eslint/next';

export default [
  ...baseNext,
  {
    plugins: { '@next/next': nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
    },
  },
  {
    ignores: ['.next/**', 'node_modules/**'],
  },
];
