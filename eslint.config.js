// @ts-check
import { defineConfig } from 'eslint/config';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['dist/', 'coverage/', 'node_modules/'] },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // `_name` marks a parameter kept for signature symmetry (e.g. step(a, dt, gm, _hour, _rain)).
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
  // Config files run in Node and sit outside the app tsconfig; lint them without type info.
  { files: ['*.config.{js,ts}'], extends: [tseslint.configs.disableTypeChecked] },
);
