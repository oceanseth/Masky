import { defineConfig } from 'vite';
import { copyFileSync, mkdirSync, readdirSync, statSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: './index.html',
        membership: './membership.html'
      }
    }
  },
  server: {
    port: 3000,
    strictPort: true, // Force port 3000, don't try other ports
    open: true
  },
  // Copy locale files to dist after build
  plugins: [
    {
      name: 'copy-locales',
      closeBundle() {
        const copyRecursive = (src, dest) => {
          mkdirSync(dest, { recursive: true });
          const entries = readdirSync(src);
          for (const entry of entries) {
            const srcPath = join(src, entry);
            const destPath = join(dest, entry);
            if (statSync(srcPath).isDirectory()) {
              copyRecursive(srcPath, destPath);
            } else {
              copyFileSync(srcPath, destPath);
            }
          }
        };
        copyRecursive('src/locales', 'dist/src/locales');
        console.log('✓ Locale files copied to dist/src/locales');        
      }
    }
  ]
});

