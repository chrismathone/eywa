import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({ plugins: [react()], optimizeDeps: { include: ['zod'] }, resolve: { alias: { '@': fileURLToPath(new URL('../../src', import.meta.url)) } }, css: { postcss: { plugins: [] } }, server: { host: '127.0.0.1', port: 4317, strictPort: true,
  fs: { allow: ['../..'] },
  proxy: { '/api/timetable/lab/': { target: 'http://127.0.0.1:4320', changeOrigin: true } },
} });
