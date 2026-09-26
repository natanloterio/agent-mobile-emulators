import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' para o index.html funcionar carregado via file:// dentro do Electron.
export default defineConfig({
  plugins: [react()],
  base: './',
  server: { port: 5173, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true },
});
