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
        manualChunks: {
          // Heavy renderers split into dedicated chunks for better caching and parallel load
          katex: ['katex', 'rehype-katex', 'remark-math'],
          mermaid: ['mermaid'],
          markdown: ['react-markdown', 'streamdown', 'remark-gfm', 'remark-cjk-friendly', 'rehype-highlight'],
        },
      },
    },
    chunkSizeWarningLimit: 1000,
  },
  server: {
    host: '0.0.0.0',
    port: 3003,
    https: loadHttpsConfig(),
    hmr: {
      timeout: 5000,
    },
    proxy: {
      '/api': 'http://localhost:4003',
      '/ws': {
        target: 'ws://localhost:4003',
        ws: true,
      },
    },
  },
});
