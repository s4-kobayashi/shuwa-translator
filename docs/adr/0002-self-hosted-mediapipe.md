# ADR 0002: MediaPipe 0.10.35 をリポジトリに同梱する

- 日付: 2026-11-18
- 状態: 採用

## 背景

MediaPipe の wasm とモデル(約 35 MB)は CDN(jsDelivr と storage.googleapis.com)からも読み込める。

## 検討した案

1. CDN から読み込む — リポジトリは軽いが、第三者のサーバーに依存し、閲覧者のアクセスが第三者に記録される。CDN 側の変更で動かなくなる可能性がある。
2. `vendor/` に同梱して GitHub Pages から配信する — リポジトリは 35 MB 増えるが、同一オリジンで完結し、バージョンが固定される。

## 決定

2 を採用。`scripts/fetch-vendor.mjs` で npm と公式ストレージから取得し、SHA-256 を `vendor/mediapipe/CHECKSUMS.txt` に記録する。1.x 系は API 変更の有無を確認できなかったため、0.10 系最終の 0.10.35 に固定する。

同じ理由で Web フォントも読み込まない。字幕の書体は Windows 10 以降に標準搭載の BIZ UDPゴシック(UD 書体)を指定し、なければ Hiragino / Noto Sans JP にフォールバックする。

## 可逆性

可逆。`js/detector.js` の `BASE` を CDN の URL に変えれば切り替えられる。
