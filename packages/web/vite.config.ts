import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';

const certDir = path.resolve(__dirname, '../../certs');

const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf-8'));

// Only load certs for dev server (not during build)
function loadHttpsConfig() {
  try {
    return {
      key: fs.readFileSync(path.join(certDir, 'key.pem')),
      cert: fs.readFileSync(path.join(certDir, 'cert.pem')),
    };
  } catch {
    return undefined; // Certs not available (e.g., Docker build)
  }
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Only split mermaid: it's heavy (~540 KB) and standalone. Splitting
        // unified-based packages (rehype-katex, remark-*, react-markdown,
        // streamdown) across chunks causes TDZ "Cannot access X before
        // initialization" errors due to shared transitive deps from `unified`.
        manualChunks: {
          mermaid: ['mermaid'],
        },
      },
    },
    chunkSizeWarningLimit: 1500,
  },
  server: {
    host: '0.0.0.0',
    port: 3003,
    https: loadHttpsConfig(),
    hmr: {
      timeout: 5000,
    },
    proxy: {
      '/api': { target: 'https://localhost:4003', changeOrigin: true, secure: false },
      '/ws': { target: 'wss://localhost:4003', ws: true, changeOrigin: true, secure: false },
    },
  },
});
