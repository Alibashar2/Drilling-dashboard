import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // PGlite ships its own WASM bundle and must not be pre-bundled by esbuild.
  optimizeDeps: { exclude: ['@electric-sql/pglite'] },
  server: { port: 5173, strictPort: false },
  build: { chunkSizeWarningLimit: 2500 },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
