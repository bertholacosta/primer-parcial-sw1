/// <reference types="vitest" />
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const modelServerOrigin = process.env.VITE_MODEL_SERVER_URL ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // collaboration-protocol usa node:crypto; en el navegador se sustituye
      // por el shim con Web Crypto + @noble/hashes (misma semántica SHA-256).
      'node:crypto': fileURLToPath(new URL('./src/shims/nodeCrypto.ts', import.meta.url)),
    },
  },
  server: {
    proxy: {
      '/api': { target: modelServerOrigin, changeOrigin: true },
      '/collaboration': { target: modelServerOrigin, changeOrigin: true, ws: true },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.ts'],
  },
});
