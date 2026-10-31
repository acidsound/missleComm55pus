import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// HTTPS=1 enables a self-signed cert so headsets on the LAN get a secure
// context (WebXR requires https except on localhost).
export default defineConfig({
  base: './',
  plugins: process.env.HTTPS ? [basicSsl()] : [],
  server: { host: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
