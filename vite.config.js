import { defineConfig } from 'vite';
import { copyFileSync, mkdirSync, readdirSync, statSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export default defineConfig(({ mode }) => {
  const isProduction = mode === 'production';

  const buildConfig = {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: './index.html',
        twitchevent: './twitchevent.html',
        user: './user.html'
      }
    }
  };

  if (isProduction) {
    buildConfig.esbuild = {
      drop: ['console', 'debugger']
    };
  }

  return {
    root: '.',
    publicDir: 'public',
    build: buildConfig,
    server: {
      port: 3000,
      strictPort: true, // Force port 3000, don't try other ports
      open: true,
      // Rewrite user URLs (/{username}) to user.html for local testing
      middlewareMode: false,
      fs: {
        strict: false
      }
    },
    // Copy locale files to dist after build
    plugins: [
      {
        name: 'rewrite-user-urls',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            // Match /{username} pattern (no slashes in path except leading slash)
            const userUrlPattern = /^\/([^\/]+)$/;
            // Exclude known routes and file extensions
            const excludedPaths = ['/api', '/assets', '/src', '/favicon.ico', '/index.html', '/membership.html', '/twitchevent.html', '/user.html'];
            const hasExtension = /\.[a-zA-Z0-9]+$/.test(req.url.split('?')[0]);
            
            if (userUrlPattern.test(req.url) && !excludedPaths.some(path => req.url.startsWith(path)) && !hasExtension) {
              req.url = '/user.html';
            }
            next();
          });
        }
      },
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
          // Copy i18n locales
          copyRecursive('src/locales', 'dist/src/locales');
          console.log('✓ Locale files copied to dist/src/locales');

          // Static assets are served from Vite's public/ directory; no manual copy needed
        }
      }
    ]
  };
});

