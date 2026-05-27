# 会社共有チェックリスト LINE Bot（Firebase Spark 主系）

`tasks.md` を正として実装を進めるリポジトリです。  
現行運用は `LIFF (GitHub Pages) + Firebase Auth + Firestore + GitHub Actions` を主系にします。GAS と Firebase Functions は本番運用の主系として使いません。

## 制作背景
- 店舗の日々の確認作業が属人的になりやすく、従業員全員が同じ未完了項目をすぐ確認できる仕組みが必要だった。
- 紙や口頭のチェックでは「誰が・いつ完了したか」が残りにくく、確認漏れや引き継ぎ漏れの原因になる。
- 店舗スタッフが普段使う LINE から開ける画面にすることで、新しい専用アプリを導入せず日常業務へ組み込みやすくする。
- 初期版は `1ユーザー = 1店舗` に絞り、日間・週間・月間の清掃チェックを確実に回すことを目的にする。

## 技術選定と意図
- LIFF: 従業員が LINE からチェック画面を開けるようにし、LINE の認証コンテキストから表示名やユーザー情報を扱う。
- GitHub Pages: LIFF 画面と管理者画面は静的ファイルで成立するため、サーバー運用を増やさず `pages/` をそのまま公開する。
- Firebase Auth: Firestore 更新時の認証境界として使う。管理者は Email/Password ログイン後、Firestore の `stores/{storeId}/admins/{uid}` allowlist で判定する。
- Firestore: 複数端末で同じチェック状態を共有し、`checkedBy` と `checkedByUserId` によって実行者を記録する正本データとして使う。
- Firestore Rules: クライアントから直接 Firestore に書き込む構成にする代わりに、管理者操作・従業員のチェック更新・イベント作成の許可範囲をデータ構造ごとに制限する。
- GitHub Actions: Firebase Spark 前提で Cloud Functions を主系にせず、10:35 の日次タスク作成と 00:35 の未完了通知を定期実行する。
- LINE Messaging API: 未完了タスクを従業員へ push 通知する。通知に必要なアクセストークンは GitHub Actions secrets で管理する。

## 確定仕様（tasks.md 準拠）
- 初期版は `1ユーザー = 1店舗` 前提。
- 当日判定は日本時間 10:30 切替（`10:30〜翌10:29` を同じ運用日として扱う）。
- 日次ジョブは GitHub Actions で 10:35 開始処理、00:35 未完了通知を実行する。
- チェック実行者は Firestore の `checkedBy` と `checkedByUserId` に保存する。
- 更新系は Firebase Auth のログイン状態が必須。

## 構成
- API/バックエンド: Firestore 直接書き込みと GitHub Actions (`scripts/`)
- 正本データ: Firestore
- LIFF フロント: GitHub Pages (`pages/`)
- 管理者画面: GitHub Pages (`pages/admin.html`)
- Firestore: タスク、テンプレート、日別実行項目、ユーザー、管理者allowlistを保存

## 運用手順
- 非IT担当者向けの現行運用説明書は [docs/operations/non-it-operator-guide.md](/home/sota411/Documents/project/ogawaya/docs/operations/non-it-operator-guide.md) を参照してください。
- Firebase Spark 主系の技術運用は [docs/operations/firebase-spark-primary.md](/home/sota411/Documents/project/ogawaya/docs/operations/firebase-spark-primary.md) を参照してください。
- 旧GAS主系の参考資料は [docs/operations/bootstrap.md](/home/sota411/Documents/project/ogawaya/docs/operations/bootstrap.md) に残っています。

## ディレクトリ
- [docs/](/home/sota411/Documents/project/ogawaya/docs)
- [pages/](/home/sota411/Documents/project/ogawaya/pages)
- [scripts/](/home/sota411/Documents/project/ogawaya/scripts)
- [tasks.md](/home/sota411/Documents/project/ogawaya/tasks.md)

## ローカル準備
- Node.js をインストール
- `npm ci`

## テスト
- `npm test`

## 必要な本番設定
- Firebase Authentication: Email/Password と Anonymous を有効化する。
- Firestore Rules: [docs/operations/firestore.rules](/home/sota411/Documents/project/ogawaya/docs/operations/firestore.rules) を適用する。
- 管理者: Firebase Auth のUIDを `stores/store-hashimoto/admins/{uid}` に登録する。
- GitHub Actions secrets:
  - `FIREBASE_SERVICE_ACCOUNT_JSON`
  - `LINE_CHANNEL_ACCESS_TOKEN`
- GitHub Actions variables:
  - `STORE_ID`。未設定時は `store-hashimoto` を使う。

## 自動処理
- `Deploy LIFF Pages`: `pages/` を GitHub Pages へ公開する。
- `Daily start`: JST 10:35 に `scripts/daily-start.mjs` を実行し、当日分タスクを作成する。
- `Incomplete reminder`: JST 00:35 に `scripts/incomplete-reminder.mjs` を実行し、前日分の未完了通知を送る。

## Firestore同期
- チェック操作、テンプレート挿入、日付内タスク削除は Firestore へ直接保存する。
- リアルタイム同期用イベントは `stores/{storeId}/runs/{targetDate}/events/*` に保存する。
- 日別タスクは `stores/{storeId}/runs/{targetDate}/items/*` に保存する。
- 統計タブは Firestore の日別データをクライアントで集計する。

## LIFF 起動時間の計測
- `pages/` のURLに `?debugTiming=1` を付けると、起動時間のウォーターフォールを画面下部とブラウザconsoleに表示する。
- 解除する場合は `localStorage.removeItem('ogawaya:debug-timing')` を実行する。
