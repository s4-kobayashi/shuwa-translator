# 手話翻訳システム 実装計画

## Context

Webカメラに映った手話を、ブラウザ(PC・スマホ)内でリアルタイムに読み取って映像上に字幕表示し、内容を記録・ダウンロードできるシステムを作る。GitHub に置き、GitHub Pages の URL を開くだけで使える静的サイトにする。作業ディレクトリ `C:\Users\lucky\手話` は空(既存コードなし)。

**前提として確認した事実(2026-11-18)**
- 日本手話(JSL)向けに、自由に再配布できる学習済みモデル・ランドマーク学習データは見つからない。ub-MOJI(指文字動画)は非商用・再配布禁止、JSL-DC(単語 36.7K 動画)は CC-BY 予定だが公開未確認。→ 「学習済み深層モデルで開語彙翻訳」は現時点で作れない。
- MediaPipe tasks-vision: 0.10.35(2026-04-27)が 0.10 系最終。1.x は API 変更未確認のため 0.10.35 を採用。モデル URL(hand_landmarker 7.8MB / pose_landmarker_lite 5.8MB)と CDN wasm は HTTP 200 を確認済み。

## 問題の再定義と方式選定

**再定義**: 「どんな手話でも高精度に訳す」は研究最前線でも未解決。実現できる高精度 = (1) 語彙を限定した組込み認識、(2) 自信のない出力を出さない棄却、(3) 利用者が自分の手話を数回見せて登録できる少数サンプル学習、(4) 信頼度の可視化と手直し、の組合せ。これを計画の前提とし、最終報告でも明示する。

**制約** hard: サーバなし静的配信 / HTTPS カメラ / PC+iOS Safari+Android Chrome / 映像は端末外に出さない。soft: 語彙数、アセットの置き場所。out of scope: 文法・表情(NMM)を含む連続文の翻訳、サーバ側 ML、音声読み上げ。

| 案 | 軸 | 評価 |
|---|---|---|
| A ルールのみ(baseline) | 幾何ルールで指文字・単語を判定 | 設定ゼロで動くが、個人差に弱く精度上限が低い |
| B 少数サンプル学習のみ | 利用者が登録した見本と DTW/kNN 照合 | 登録者には高精度、初期語彙ゼロ |
| C クラウド VLM(制約緩和: APIキー許容) | フレームを Gemini/Claude に送る | 手話認識は不得手・遅延・費用・キーが静的ページで露出・映像が外部送信 → 不採用 |
| D ASL 学習済みモデル流用(言語制約緩和) | Kaggle GISLR 250語 | 英語/ASL で要件(日本語)と不一致 → 不採用 |

**基準**: c1 URL を開くだけで即使える(R7) / c2 精度を利用者が上げられる(R6) / c3 端末内処理(人物映像のプライバシー) / c4 スマホで ≥15fps / c5 実手話者なしでも自分で検証できる。
**採用: A+B ハイブリッド**。組込みルールで初期語彙を持ち(c1)、登録見本が同じラベルの組込みより優先され(c2)、全処理端末内(c3)、合成データで単体検証可能(c5)。

## アーキテクチャ(ビルド不要の vanilla ES modules)

```
index.html / css/app.css / .nojekyll / README.md / LICENSE-THIRD-PARTY
js/main.js          起動・配線
js/camera.js        getUserMedia、前後カメラ切替、鏡像表示、playsinline
js/detector.js      HandLandmarker(numHands=2)+PoseLandmarker lite、GPU→CPU フォールバック、pose は隔フレーム
js/features.js      [pure] 肩幅正規化、指の曲げ量(3D world 座標)、親指位置、指先接触、指間開き、掌の向き、指差し方向、顔/胸基準の位置、速度
js/handshape.js     [pure] 手形プロトタイプ(重み付きファジー距離)+利用者見本 kNN、top-k と余裕度
js/fingerspelling.js [pure] 指文字表(静止形+動き付き: の/も/り/ん/を)、濁点(横移動)/半濁点(上)/促音・拗音(手前に引く)/長音(下)
js/signs.js         [pure] 組込み単語ルール(手形×位置×動き×両手関係)、複合語結合(例: 昼+挨拶→こんにちは)
js/segmenter.js     [pure] 動作区間の切り出し(手の出現・運動エネルギー・静止で開始/終了)
js/dtw.js           [pure] 32点リサンプル+DTW+kNN、見本の leave-one-out 距離から棄却閾値を算出
js/recognizer.js    [pure] 静止保持→指文字、動作区間→単語、時間平滑化・確定ゲージ・棄却
js/transcript.js    [pure] 記録モデル、TXT/CSV(BOM)/JSON/SRT 書き出し
js/storage.js       IndexedDB(辞書・セッション履歴)、辞書 JSON 入出力
js/recorder.js      映像+字幕を合成した canvas を MediaRecorder で録画(webm / Safari は mp4)
js/ui/*.js          字幕オーバーレイ、骨格描画、記録パネル、辞書画面、設定、ヘルプ(組込み語彙一覧)
vendor/mediapipe/   tasks-vision@0.10.35 の vision_bundle.mjs + wasm、2 モデル(自前配信)
scripts/fetch-vendor.mjs  上記を npm pack と公式 storage から取得し sha256 を記録
scripts/serve.py    .wasm/.mjs の MIME を明示する開発サーバ(htmlpage の serve.py を拡張)
tests/*.test.mjs    node --test(依存なし)
tests/testkit/handmodel.mjs  パラメトリック手モデル(曲げ角・回転・スケール→21点)
tests/e2e/*.mjs     playwright-core + 既存 Edge、偽カメラ(y4m)
docs/vocabulary.md  組込み語彙の定義と出典 / docs/adr/*.md / docs/PLAN.md(本計画の写し)
```

**重要な実装上の注意**: MediaPipe の handedness は鏡像入力前提なので、非鏡像フレームを渡すと左右が逆になる → features.js で補正しテストで固定。利き手設定(左利き)は x 反転でテンプレートを共用。

## UI 設計(コード前のトークンプラン)

- 主題: 放送字幕と通訳。単一の仕事は「映っている手話を字幕として読ませる」。
- 参照: NHK 字幕(白文字+黒縁・2行以内)/ Google Live Transcribe(未確定は薄く、確定で濃く)。
- 色: `--sumi #16181D`(映像ステージ周囲)/ `--kumo #EEF1F4`(パネル地)/ `--ai #23497A`(操作・選択)/ `--kihada #FFD23F`(未確定字幕と確定ゲージ)/ `--shu #C8432B`(録画中・エラーのみ)/ `--nezumi #5B6270`(副文)。
- 書体: 字幕・見出し = BIZ UDPGothic 700(UD書体、聴覚障害者の可読性が理由)、本文 = OS の日本語ゴシック、時刻 = tabular-nums。字幕 clamp(28px,5vw,56px) : 本文 16px で比 ≥3。
- 予算: 角丸 2値(6px / 14px)、影 1段、カード乱用なし、eyebrow/ピル不使用、斜体見出しなし。
- Signature: **確定ゲージ付き字幕**。認識中の文字は黄で表示し下線ゲージが保持時間に応じて伸び、確定で白字幕行に収まる。モーションはこの1箇所のみ、reduced-motion では即時切替。
- レイアウト: デスクトップ = 左 8 映像ステージ(字幕は下1/3)/ 右 4 記録タイムライン+操作。モバイル = 映像を全幅上部、記録を下、録画・保存・停止は下端固定バー。画面: 翻訳 / 辞書 / 設定 / 使い方。

## 実装ステップ

1. [enabling・スパイク] 雛形と MediaPipe 0.10.35 + 2 モデルを vendor/ に取得、スパイクページで手+姿勢検出。偽カメラ映像は MediaPipe 公式アセット(storage.googleapis.com/mediapipe-assets)の手の写った画像1枚をスクラッチパッドに取得し ffmpeg で y4m 化。— Done: playwright-core+Edge の実行ログに `hands>=1 pose=true fps>=10`、コンソールエラー 0。
2. [R2,R6] 語彙調査 → `docs/vocabulary.md`。指文字 46 字+単語約 20 語(ありがとう・こんにちは・おはよう・よろしく・ごめんなさい・私・あなた・名前・手話・好き・大丈夫・わかる・会う・何・待つ・元気・嬉しい・助けて・いいえ 等)を公開資料で手形/位置/動きを確認し出典を記載。確認できない項目は組込みから外し「辞書登録で追加可能」と明記。— Done: 各項目に出典 URL、採用数と除外数を記録。
3. [R2,R6] 純粋モジュール(features〜recognizer)と合成手モデル。— Done: `node --test tests/` 全通過。基準値: 手形 top-1 ≥95%(ノイズ σ=0.01、回転 ±25°、スケール ±20%)、ランダム手形の誤受理 ≤5%、少数サンプル(各3見本)DTW 認識 ≥90%、組込み単語の合成軌跡で各語 top-1、左右・鏡像補正テスト。
4. [R1,R3] 画面・カメラ・字幕オーバーレイ・骨格表示・前後カメラ切替・設定(利き手/モード/保持時間/感度)。`?test=1` のときだけランドマーク列を注入できるフック。— Done: 偽カメラ E2E で映像表示・オーバーレイ描画・注入列で字幕が確定まで進むことを DOM で確認、1440/390px のスクショ目視。
5. [R4,R5] 記録(セッション自動保存・履歴・編集/削除)と TXT/CSV/JSON/SRT ダウンロード、字幕合成録画。— Done: 書き出し単体テスト通過、E2E の download イベントで各ファイル内容を検証、録画ファイルが 0 byte でない。
6. [R6] 辞書: 3〜5 回の見本登録(静止/動作を自動判別)、組込み上書き、信頼度 top-3 表示、JSON 入出力。— Done: E2E で注入列から登録 → 同系列の再生がそのラベルで認識される。
7. [R7] Pages 前提の整備: 全パス相対、.nojekyll、README(公開手順・使い方・語彙一覧・精度の限界・プライバシー)、Apache-2.0 表示。— Done: `/<repo名>/` サブパス配信で 404 ゼロ、絶対パス grep 0 件。
8. [品質] audit.js で 1440/768/390 の `scrollWidth<=innerWidth` 実測、de-AI カウント、フォーカス/reduced-motion/コントラスト確認、全テスト再実行、fable5-quality-reviewer と fable5-design-reviewer に証拠添付で light 監査。— Done: 監査指摘ゼロ or 修正済み。

**トレーサビリティ**: R1 カメラ(PC/スマホ)→4 / R2 手話の読み取り→2,3 / R3 映像上の文字起こし→4 / R4 記録→5 / R5 ダウンロード→5 / R6 高精度→2,3,6 / R7 GitHub URL で利用→1,7。enabling: 1,8。

## 仮定(外れた場合の影響)

- 対象は日本手話・日本語対応手話の標準的な形、出力は日本語 — ASL 等なら語彙データ差し替え(構造は不変)。
- 既定は右利き、左利き切替あり — 影響小。
- Pages は「ブランチ/ルート」配信、リポジトリ名不明 → 全相対パス — 影響なし。
- 初回 約25MB の読込を許容 — 不可なら CDN 版に切替(ADR に記録)。
- 対応: Chrome/Edge(PC/Android)、iOS Safari 16+ — 古い端末は CPU フォールバックで低 fps。

## 未決事項

- 組込み語彙の地域差(東京/関西の「名前」など)は標準手話寄りで実装し、辞書登録で上書き可能にする。
- 実際の手話者での精度は本環境で測れない(カメラ・手話者なし)。合成データの数値と、利用者向けの信頼度表示・辞書登録で補う。最終報告で明記する。

## 中止・再計画基準

- ステップ1で vendored アセットが 2 回の修正後も動かない → CDN 読込か HolisticLandmarker に切替。
- 手形分類の合成 top-1 が調整後も 85% 未満 → 組込み指文字を分離可能な部分集合に絞る。
- デスクトップで 8fps 未満 → pose を 3 フレームに 1 回、それでも不足なら pose を外す。

## 検証(エンドツーエンド)

- `node --test tests/`(純粋ロジック・合成精度・書き出し形式)
- `uv run scripts/serve.py 8099 .` で配信 → `node tests/e2e/run.mjs`(playwright-core、Edge、`--use-fake-device-for-media-stream --use-file-for-fake-video-capture=<y4m>`):起動・検出・字幕・記録・DL・辞書登録
- Playwright MCP で 1440/768/390 のスクショと overflow 実測(audit.js)、カメラ拒否時の画面
- サブパス配信で GitHub Pages 相当の読込確認

保存先: 本ファイル(実装開始時に `docs/PLAN.md` へ写す)。
