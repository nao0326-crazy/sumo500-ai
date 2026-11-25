import { defineConfig } from 'vite';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

function listFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? listFiles(full) : [full];
  });
}

// Writes dist/sw.js after every production build: the precache list is exactly the
// files of this build, and the cache name changes whenever any of them changes.
function serviceWorkerPlugin() {
  let outDir = 'dist';
  return {
    name: 'sumo500-service-worker',
    apply: 'build',
    configResolved(config) { outDir = resolve(config.root, config.build.outDir); },
    closeBundle() {
      const files = listFiles(outDir)
        .map((file) => `/${relative(outDir, file).split('\\').join('/')}`)
        .filter((path) => path !== '/sw.js' && !path.endsWith('.map'))
        .sort();
      const hash = createHash('sha256');
      for (const path of files) hash.update(path).update(readFileSync(join(outDir, path)));
      const version = `${pkg.version}-${hash.digest('hex').slice(0, 12)}`;
      const precache = ['/', ...files];
      const template = readFileSync(new URL('./pwa/sw-template.js', import.meta.url), 'utf8');
      writeFileSync(join(outDir, 'sw.js'), template.replace('__SW_VERSION__', version).replace('__PRECACHE_LIST__', JSON.stringify(precache, null, 2)));
      console.log(`[sumo500] sw.js: ${precache.length} files precached, cache sumo500-${version}`);
    }
  };
}

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: { outDir: 'dist', emptyOutDir: true, assetsInlineLimit: 0 },
  server: { host: true, port: 3000 },
  preview: { host: true, port: 3000 },
  plugins: [serviceWorkerPlugin()]
});
