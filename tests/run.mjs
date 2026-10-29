// Bundles the test files with the esbuild that ships with Vite, then runs them with node:test.
// npm packages stay external (resolved from node_modules), so the bundles are written inside the project.
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';

const outdir = 'tests/.out';
rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });
await build({
  entryPoints: ['tests/funnel.test.ts', 'tests/api.test.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outdir,
  outExtension: { '.js': '.mjs' },
  packages: 'external',
  loader: { '.png': 'empty', '.webp': 'empty', '.jpg': 'empty' },
  define: { 'import.meta.env': JSON.stringify({ DEV: false, VITE_FUNNEL_MODE: 'mock', VITE_GA4_MEASUREMENT_ID: 'G-TEST', VITE_MONEY_BACK_DAYS: '30' }) },
  logLevel: 'warning',
});
const r = spawnSync(process.execPath, ['--test', `${outdir}/funnel.test.mjs`, `${outdir}/api.test.mjs`, 'tests/finder-api.test.mjs'], { stdio: 'inherit' });
rmSync(outdir, { recursive: true, force: true });
process.exit(r.status ?? 1);
