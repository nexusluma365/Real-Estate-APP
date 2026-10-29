import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Production deploys to werentreadygo.com/finder, so assets are served from /finder/.
// `npm run build:single` produces one self-contained HTML file for design review.
export default defineConfig(({ mode }) => ({
  base: mode === 'single' ? './' : '/finder/',
  plugins: [react(), ...(mode === 'single' ? [viteSingleFile()] : [])],
  define: {
    __ROUTER_MODE__: JSON.stringify(mode === 'single' ? 'hash' : 'browser'),
  },
  build: {
    outDir: mode === 'single' ? 'dist-single' : 'dist',
  },
}));
