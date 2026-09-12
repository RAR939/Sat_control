// vite.config.ts
//
// Конфигурация сборщика Vite для фронтенда.
// Подключаем React (JSX/Fast Refresh) и Tailwind (генерация CSS по классам прямо во время сборки).
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
});