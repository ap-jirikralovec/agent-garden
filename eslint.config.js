import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import vue from 'eslint-plugin-vue';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores(['dist/**', 'coverage/**', 'node_modules/**', '*.tgz']),
  js.configs.recommended,
  tseslint.configs.recommended,
  vue.configs['flat/recommended'],
  {
    files: ['src/server/**/*.ts', 'scripts/**/*.ts', 'tests/**/*.{ts,mjs}', '*.config.{js,ts}'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/client/**/*.{ts,vue}'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['**/*.vue'],
    languageOptions: { parserOptions: { parser: tseslint.parser } },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  prettier,
);
