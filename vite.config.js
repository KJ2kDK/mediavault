import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      // Stream endpoints need special handling to avoid buffering
      '/api/plex/stream': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        // Increase timeout for long-running FFmpeg streams
        timeout: 0,
        proxyTimeout: 0,
      },
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
});
