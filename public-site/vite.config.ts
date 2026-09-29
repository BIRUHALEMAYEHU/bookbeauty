import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  plugins: [react()],
  server: {
    host: true,
    port: 3020,
    proxy: {
      '/api': 'http://127.0.0.1:3001'
    }
  },
  build: {
    outDir: path.join(root, 'dist'),
    emptyOutDir: true
  }
});
