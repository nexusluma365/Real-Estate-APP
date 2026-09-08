import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Same-logic note: this config only controls HOW the existing pages are
// bundled and served. It does not change any page's markup, styles, or
// script behavior. In dev, /.netlify/functions/* is proxied to `netlify
// dev`'s local functions server (default port 8888) so the app talks to
// the exact same backend it will in production.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/.netlify/functions': {
        target: 'http://localhost:8888',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
