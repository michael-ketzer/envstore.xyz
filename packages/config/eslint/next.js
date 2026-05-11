// ESLint flat config for Next.js apps.
// Layered on top of base.js — adds React Hooks rules.
//
// We deliberately don't depend on eslint-plugin-react:
//   - It hasn't migrated to ESLint 10's API (calls removed `context.getFilename()`).
//   - Most useful rules (props-types, react-in-jsx-scope) are obviated by
//     TypeScript and Next.js's own plugin.
// @next/eslint-plugin-next is loaded by the app itself (apps/web/eslint.config.mjs).

import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

import { baseConfig } from './base.js';

/** @type {import("eslint").Linter.Config[]} */
export const nextConfig = [
  ...baseConfig,
  {
    files: ['**/*.{ts,tsx,jsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
];

export default nextConfig;
