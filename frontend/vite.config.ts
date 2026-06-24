import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      // Buffer, process, etc — required by @stellar/stellar-sdk in browser
      globals: { Buffer: true, global: true, process: true },
    }),
  ],
});
