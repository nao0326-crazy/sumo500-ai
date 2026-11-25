# SUMO 500 — Vercel公開用

## Vercel設定
- Framework Preset: Vite
- Root Directory: `.`
- Build Command: `npm run build`
- Output Directory: `dist`
- Install Command: `npm install`（またはVercel自動判定）

`vercel.json` は `/battle` `/result` `/growth` をSPAの入口へ戻す設定です。画面を直接開いたり再読み込みしたときの404を防ぎます。

## 注意
- このアプリのAI学習データはブラウザのlocalStorageに保存されます。端末・ブラウザごとに別データで、ブラウザデータ消去や端末変更では引き継がれません。
- Vercelへ通常デプロイしたURLは、URLを知っている人ならアクセスできます。URLを秘密にするだけではアクセス制限になりません。
- 公開後は、スマホのChromeでURLを開き、対戦・画面遷移・再読み込み・ホーム画面追加・オフライン起動を確認してください。
