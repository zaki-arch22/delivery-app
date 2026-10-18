import { defineConfig, loadEnv, Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Strict Content-Security-Policy: only this site's own files may run, nothing inline, no third-party scripts, fonts or images.
// The ONLY outside address the page may talk to is the API.
const csp = (api: string): Plugin => ({
  name: 'csp',
  transformIndexHtml: html => html.replace('__CONNECT__', api),
});
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const api = env.VITE_API_URL ? new URL(env.VITE_API_URL).origin : "'self'";
  return {
    plugins: [react(), csp(api)],
    build: { target: 'es2020', sourcemap: false, assetsInlineLimit: 0 },
    test: { environment: 'jsdom', globals: true, testTimeout: 30000, hookTimeout: 30000, fileParallelism: false, setupFiles: ['./test/setup.ts'] },
  };
});
