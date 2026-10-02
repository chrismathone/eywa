import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({ plugins: [react()], css: { postcss: { plugins: [] } }, server: { host: '127.0.0.1', port: 4317, strictPort: true,
  proxy: { '/api/timetable/lab/': { target: 'http://127.0.0.1:4320', changeOrigin: true } },
} });
