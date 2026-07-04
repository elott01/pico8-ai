import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// public/ is copied verbatim to the build root (so /games/<cart>.js serves as-is),
// and the repo-root api/ folder is left untouched for Vercel's serverless runtime.
export default defineConfig({
  plugins: [react()],
});
