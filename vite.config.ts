import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: { sourcemap: false, target: 'es2020' },
  // RentReady Finder is its own app; in development run it with `npm --prefix rentready-finder run dev -- --port 5174`.
  server: { port: 5173, proxy: { '/finder': { target: 'http://127.0.0.1:5174', ws: true } } },
});
