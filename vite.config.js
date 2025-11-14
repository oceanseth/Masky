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
            // Extract pathname (remove query string and hash)
            const pathname = req.url.split('?')[0].split('#')[0];
            
            // Don't treat root path (/) as a username
            if (pathname === '/') {
              next();
              return;
            }
            
            // Match /{username} pattern (no slashes in path except leading slash)
            const userUrlPattern = /^\/([^\/]+)$/;
            // Exclude known routes and file extensions
            const excludedPaths = ['/api', '/assets', '/src', '/favicon.ico', '/index.html', '/membership.html', '/twitchevent.html', '/user.html'];
            const hasExtension = /\.[a-zA-Z0-9]+$/.test(pathname);
            
            if (userUrlPattern.test(pathname) && !excludedPaths.some(path => pathname === path || pathname.startsWith(path + '/')) && !hasExtension) {
              // Preserve query string when rewriting
              const queryString = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
              req.url = '/user.html' + queryString;
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

