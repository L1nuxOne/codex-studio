import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(() => ({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    hmr: {
      protocol: 'ws',
      host: 'localhost'
    },
    watch: {
      ignored: ['**/src-tauri/**']
    }
  },
  publicDir: 'config',
  build: {
    target: ['es2021', 'chrome100', 'safari13'],
    minify: process.env.TAURI_DEBUG ? false : 'esbuild',
    sourcemap: !!process.env.TAURI_DEBUG
  }
}));
