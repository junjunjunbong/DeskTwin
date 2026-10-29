import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: Number(process.env.DESKTWIN_WEB_PORT ?? 5173),
    strictPort: true,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${process.env.PORT ?? 4318}`,
        // The API checks the browser's exact Origin against Host. Vite's string
        // shorthand rewrites Host to the API port and breaks same-origin POSTs.
        changeOrigin: false,
      },
    },
  },
  build: { chunkSizeWarningLimit: 700 },
  test: { include: ['src/**/*.test.ts', 'server/**/*.test.ts'], environment: 'node' },
});
