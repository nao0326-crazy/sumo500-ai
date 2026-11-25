#!/usr/bin/env node
// Runs before `npm run build` (npm "prebuild"). Fails early with a clear message when the
// repository contains build output instead of sources — the cause of Vercel errors like
//   "Failed to resolve /assets/index-XXXX.js from /vercel/path0/index.html"
//   "Failed to resolve /src/main.js from /vercel/path0/index.html"
import { existsSync, readFileSync, readdirSync } from 'node:fs';

const problems = [];
const html = existsSync('index.html') ? readFileSync('index.html', 'utf8') : null;
if (!html) problems.push('プロジェクト直下に index.html がありません。');
else {
  if (/\/assets\/index-[\w-]+\.(js|css)/.test(html)) problems.push('直下の index.html がビルド後のファイル（dist/index.html のコピー）です。/assets/index-xxxx.js ではなく /src/main.js を読み込む開発用の index.html に戻してください。');
  if (!/<script[^>]+type="module"[^>]+src="\/src\/main\.js"/.test(html)) problems.push('index.html に <script type="module" src="/src/main.js"></script> がありません。');
}
for (const file of ['src/main.js', 'src/game.js', 'src/data.js', 'src/styles.css', 'pwa/sw-template.js', 'public/manifest.webmanifest']) {
  if (!existsSync(file)) problems.push(`${file} がありません（フォルダごとアップロードされているか確認してください）。`);
}
if (existsSync('assets') && readdirSync('assets').some((name) => /^index-[\w-]+\.(js|css)$/.test(name))) problems.push('直下に assets/index-xxxx.js（ビルド成果物）があります。dist の中身はリポジトリのソースとして置かないでください。');
if (problems.length) {
  console.error('\n[SUMO 500] ビルド前チェックでエラー:\n' + problems.map((p) => `  - ${p}`).join('\n') + '\n');
  process.exit(1);
}
console.log('[SUMO 500] source check OK');
