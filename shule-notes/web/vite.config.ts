import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The website is plain files (no server of its own): nginx serves them and every request for data goes to the
// same Shule Notes server the phone app uses.
export default defineConfig({
  plugins: [react()],
  build: { target: 'es2020', sourcemap: false, chunkSizeWarningLimit: 900 },
});
