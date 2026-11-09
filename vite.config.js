import { defineConfig } from 'vite';

// GitHub Pages serves the site from /<repo>/; locally it stays at /.
export default defineConfig({
  base: process.env.BASE_PATH || '/',
});
