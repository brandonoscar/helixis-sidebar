import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { copyFileSync, existsSync } from 'fs';
import { rollup } from 'rollup';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'chrome-extension-build',

      // Strip the crossorigin attribute Vite adds — not needed for extension pages
      transformIndexHtml(html) {
        return html.replace(/ crossorigin/g, '');
      },

      async closeBundle() {
        // Copy static extension files
        ['manifest.json', 'content.js', 'popup.html', 'popup.js'].forEach(f => {
          if (existsSync(f)) copyFileSync(f, `dist/${f}`);
        });

        // Bundle service_worker.js + all its imports into one self-contained file.
        // This eliminates the "Status code: 2" registration failure caused by
        // Chrome struggling to resolve nested ES module imports from extensions.
        try {
          const swBundle = await rollup({
            input: 'service_worker.js',
            onwarn: () => {}, // suppress "chrome is not defined" globals warnings
          });
          await swBundle.write({ file: 'dist/service_worker.js', format: 'es' });
          await swBundle.close();
          console.log('[helixis] service_worker.js bundled ✓');
        } catch (e) {
          console.warn('[helixis] SW bundling failed, copying as-is:', e.message);
          if (existsSync('service_worker.js')) copyFileSync('service_worker.js', 'dist/service_worker.js');
        }
      },
    },
  ],

  base: './',

  build: {
    rollupOptions: {
      input: { panel: 'panel.html' },
    },
    outDir: 'dist',
    emptyOutDir: true,
  },
});
