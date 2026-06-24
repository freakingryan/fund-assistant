import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'
import unusedImports from 'eslint-plugin-unused-imports'

export default defineConfig([
  globalIgnores(['dist', 'aktools_env']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    plugins: {
      'unused-imports': unusedImports,
    },
    rules: {
      // 自动检测并移除未使用的 import
      'unused-imports/no-unused-imports': 'error',
      // 未使用的变量（排除以 _ 开头的参数）
      'unused-imports/no-unused-vars': [
        'warn',
        {
          vars: 'all',
          varsIgnorePattern: '^_',
          args: 'after-used',
          argsIgnorePattern: '^_',
        },
      ],
      // 禁止 any
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { varsIgnorePattern: '^_', argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      // 命名规范：组件名必须 PascalCase
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
])
