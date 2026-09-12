// eslint.config.js
//
// Конфигурация линтера для фронтенда КосмоХакатона.
// Используем flat config (актуальный формат ESLint начиная с v9) вместо
// устаревшего .eslintrc — так меньше конфликтов с последними версиями плагинов.
//
// Разделение ответственности:
//   - ESLint  -> ловит баги и плохие практики (неправильные хуки, unused vars, any вместо типов)
//   - Prettier -> отвечает только за форматирование (отступы, кавычки, переносы строк)
// Чтобы они не конфликтовали, в конце подключаем eslint-config-prettier,
// который ВЫКЛЮЧАЕТ все стилистические правила ESLint, дублирующие Prettier.

import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettierConfig from 'eslint-config-prettier';

export default [
  // Базовые рекомендованные правила JS от самого ESLint
  js.configs.recommended,

  {
    // Применяем эту конфигурацию только к файлам исходного кода фронтенда
    files: ['src/**/*.{ts,tsx}'],

    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
        // project: './tsconfig.json', // раскомментировать для type-aware правил (медленнее, но точнее)
      },
    },

    plugins: {
      '@typescript-eslint': tseslint,
      react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },

    rules: {
      // --- TypeScript ---
      // Запрещаем неиспользуемые переменные (частая причина мусора в коде)
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      // Предупреждаем об использовании `any` — в проекте с типами сценария/маршрута
      // это особенно важно, т.к. any "ломает" синхронизацию типов с бэкендом
      '@typescript-eslint/no-explicit-any': 'warn',

      // --- React ---
      // С новым JSX Transform (React 17+) импорт React в файле больше не нужен
      'react/react-in-jsx-scope': 'off',
      // Обязательно указывать key в списках (актуально для рендера списков спутников/событий)
      'react/jsx-key': 'error',

      // --- React Hooks ---
      // Критично для компонентов с useEffect (подписки на таймлайн, WebSocket) —
      // ловит неправильные зависимости и нарушение порядка вызова хуков
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // --- Vite Fast Refresh ---
      // Предупреждает, если файл экспортирует что-то кроме компонента —
      // это ломает hot-reload при разработке
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },

    settings: {
      react: { version: 'detect' },
    },
  },

  // Отключаем все правила ESLint, которые конфликтуют с Prettier —
  // ВСЕГДА должно идти последним в массиве, чтобы точно перекрыть предыдущие блоки
  prettierConfig,
];