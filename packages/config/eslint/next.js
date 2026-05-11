// ESLint flat config for Next.js apps.
// Layered on top of base.js — adds React/React-Hooks rules.
// @next/eslint-plugin-next is loaded by the app itself to keep the version-bump path simple.

import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

import { baseConfig } from './base.js';

/** @type {import("eslint").Linter.Config[]} */
export const nextConfig = [
  ...baseConfig,
  {
    files: ['**/*.{ts,tsx,jsx}'],
    plugins: {
      react,
      'react-hooks': reactHooks,
    },
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      // Apostrophes/quotes in JSX text are not an XSS risk and reading
      // `&apos;` makes copy hard to scan. Off across the project.
      'react/no-unescaped-entities': 'off',
    },
  },
];

export default nextConfig;
