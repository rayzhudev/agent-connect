import { defineConfig } from 'vite';
import path from 'node:path';

const workspaceRoot = path.resolve(__dirname, '..', '..');

export default defineConfig({
  optimizeDeps: {
    exclude: ['@agentconnect/sdk', '@agentconnect/ui'],
  },
  resolve: {
    alias: {
      '@agentconnect/sdk': path.resolve(workspaceRoot, 'packages/sdk/src/index.ts'),
      '@agentconnect/ui': path.resolve(workspaceRoot, 'packages/ui/src/index.ts'),
    },
  },
  server: {
    fs: {
      allow: [workspaceRoot],
    },
  },
});
