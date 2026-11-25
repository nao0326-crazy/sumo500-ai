// Deploy configuration: the repository must contain sources (not build output) and
// the Vercel / PWA settings must stay consistent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

test('root index.html is the Vite source entry, not a copy of dist/index.html', () => {
  const html = read('index.html');
  assert.match(html, /<script type="module" src="\/src\/main\.js"><\/script>/);
  assert.doesNotMatch(html, /\/assets\/index-/);
  assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/);
});

test('vercel.json builds with Vite into dist and rewrites SPA routes', () => {
  const config = JSON.parse(read('vercel.json'));
  assert.equal(config.buildCommand, 'npm run build');
  assert.equal(config.outputDirectory, 'dist');
  assert.equal(config.installCommand, 'npm install');
  const rewrite = config.rewrites.find((r) => r.destination === '/index.html');
  const pattern = new RegExp(`^${rewrite.source.replace('(?!', '(?!')}$`);
  for (const route of ['/', '/battle', '/result', '/growth', '/settings', '/backup']) assert.ok(pattern.test(route), `${route} must reach the SPA`);
  for (const file of ['/assets/index-abc.js', '/sw.js', '/manifest.webmanifest', '/icons/icon-192.png']) assert.ok(!pattern.test(file), `${file} must not be rewritten`);
  assert.ok(config.headers.some((h) => h.source === '/sw.js' && h.headers.some((x) => /no-cache/.test(x.value))), 'sw.js must not be cached by the CDN');
});

test('package.json and the lockfile agree, and the build is guarded against dist-as-source', () => {
  const pkg = JSON.parse(read('package.json')); const lock = JSON.parse(read('package-lock.json'));
  assert.equal(lock.packages[''].version, pkg.version);
  assert.deepEqual(lock.packages[''].devDependencies, pkg.devDependencies);
  assert.equal(lock.packages['node_modules/vite'].version, pkg.devDependencies.vite);
  assert.equal(pkg.scripts.build, 'vite build'); assert.match(pkg.scripts.prebuild, /check-source/);
});

test('manifest has installable PNG icons that exist, and the SW template has build placeholders', () => {
  const manifest = JSON.parse(read('public/manifest.webmanifest'));
  for (const size of ['192x192', '512x512']) assert.ok(manifest.icons.some((i) => i.sizes === size && i.type === 'image/png'), `icon ${size}`);
  assert.ok(manifest.icons.some((i) => i.purpose === 'maskable'));
  for (const icon of manifest.icons) assert.ok(existsSync(new URL(`public${icon.src}`, root)), `${icon.src} missing`);
  assert.equal(manifest.start_url, '/'); assert.equal(manifest.display, 'standalone');
  const sw = read('pwa/sw-template.js');
  assert.match(sw, /__SW_VERSION__/); assert.match(sw, /__PRECACHE_LIST__/);
  assert.ok(!existsSync(new URL('public/sw.js', root)), 'a static public/sw.js would bypass the generated, versioned worker');
});
