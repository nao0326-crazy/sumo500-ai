# SUMO 500 — Vercel 公開手順

## 1. GitHub に置くファイル（これが正しい構成）

```
index.html            ← 開発用エントリ（/src/main.js を読む）。dist/index.html で上書きしない
package.json
package-lock.json
vite.config.js        ← ビルド時に dist/sw.js を自動生成
vercel.json
.gitignore
pwa/sw-template.js
public/               ← icon.svg, icons/*.png, manifest.webmanifest
src/                  ← main.js, game.js, data.js, settings.js, pwa.js, opponents.js, styles.css, assets/*.webp, *.test.js
scripts/              ← check-source.mjs（ビルド前チェック）, headless-eval.mjs, compare-legacy.mjs
docs/
```

**入れないもの**: `dist/`、`node_modules/`、ルート直下の `assets/`。

> 以前のエラー
> - `Failed to resolve /src/main.js` … `src/` がアップロードされていなかった
> - `Failed to resolve /assets/index-Z-7VY_2r.js` … ルートの `index.html` がビルド後の `dist/index.html` に置き換わっていた
>
> 今後同じ状態になると、`npm run build` の前に `scripts/check-source.mjs` が原因を日本語で表示して止まります。

### GitHub の Web 画面でアップロードする場合
1. リポジトリの既存の `index.html`、`assets/`（ルート直下にあるもの）、古い `public/sw.js` を削除する。
2. `SUMO500-final.zip` を展開し、中身（フォルダごと）をドラッグ＆ドロップでアップロードする。`src/` `public/` `pwa/` `scripts/` がフォルダとして入っていることを確認する。

## 2. Vercel の設定
`vercel.json` に書いてあるので、ダッシュボード側は次のとおりで動きます。
- Framework Preset: **Vite**
- Root Directory: `.`
- Build Command: `npm run build`
- Output Directory: `dist`
- Install Command: `npm install`

`vercel.json` は全ルート（/battle, /result, /growth, /settings, /backup）を SPA に戻し、`sw.js` を CDN でキャッシュさせないヘッダーを付けます。

## 3. ローカルで確認するコマンド
```
npm install
npm test          # 72 件
npm run build     # dist/ と dist/sw.js を生成
npm run preview   # http://localhost:3000
npm run eval      # AI のヘッドレス対戦評価（任意・約10秒）
```

## 4. 公開後にスマホで確認すること
- Chrome で URL を開く → メニュー「ホーム画面に追加」（インストール）
- 1 戦して結果が出る → アプリを閉じて開き直し、対戦回数が増えていること
- 機内モードでホーム画面のアイコンから起動できること
- 設定 → バックアップ →「ファイルに書き出す」で JSON が保存されること

## 注意
- 学習データは端末・ブラウザごとの localStorage にあります。機種変更・ブラウザのデータ削除の前に「書き出し」をしてください。
- 公開 URL を知っている人は誰でもアクセスできます（URL を秘密にすることはアクセス制限になりません）。
