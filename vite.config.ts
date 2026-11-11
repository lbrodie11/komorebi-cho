import { defineConfig } from 'vitest/config';

// `base: './'` keeps every asset path relative so the same build works on
// GitHub Pages (project sub-path), itch.io HTML5 uploads, and a Tauri webview.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1200,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
