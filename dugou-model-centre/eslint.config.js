import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

/**
 * ESLint flat config (ESLint 9).
 *
 * Philosophy: keep the rules that catch *real* bugs as errors
 * (rules-of-hooks, undefined vars, unsafe negation, etc.) while
 * silencing purely stylistic noise that a formatter would own.
 * The codebase predates TypeScript, so prop-types / no-explicit-any
 * style rules are intentionally off — types are documented via JSDoc
 * @typedef on the analytics engine instead.
 */
export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'api/**', '*.config.js'],
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.es2021,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    settings: {
      react: { version: 'detect' },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,

      // Real-bug rules — keep as errors.
      'react-hooks/rules-of-hooks': 'error',
      'no-unsafe-negation': 'error',
      'no-dupe-keys': 'error',
      'no-self-compare': 'error',

      // CJK normalization regexes intentionally contain full-width
      // whitespace (e.g. /　/g → ' '); allow it inside literals.
      'no-irregular-whitespace': [
        'error',
        { skipStrings: true, skipComments: true, skipTemplates: true, skipRegExps: true },
      ],

      // Noisy-but-useful — warn so they surface without blocking.
      'react-hooks/exhaustive-deps': 'warn',
      'no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],

      // Off: the JSX runtime injects React; this project predates TS,
      // so prop-types and a few JSX-runtime rules are intentionally relaxed.
      'react/react-in-jsx-scope': 'off',
      'react/jsx-uses-react': 'off',
      'react/prop-types': 'off',
      'react/display-name': 'off',
      'react/no-unescaped-entities': 'off',
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    // Test files run under Vitest globals.
    files: ['**/*.test.{js,jsx}', '**/__tests__/**'],
    languageOptions: {
      globals: {
        ...globals.node,
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        vi: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
      },
    },
  },
]
