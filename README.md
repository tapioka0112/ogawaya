# LINE botで使う店舗共有チェックリスト

店舗の日々の清掃チェックを, LINEから確認, 更新, 通知できるようにした業務用チェックリストです. 今は`LIFF(GitHub Pages)+Firebase Auth+Firestore+GitHub Actions`で動かします. GASとFirebase Functionsは本番の中心にはしていません.

## 制作背景

- 店舗では日々の確認作業が人に依存しやすく, 従業員全員が同じ未完了項目をすぐ確認できる仕組みが必要だった.
- 紙や口頭のチェックでは「誰が, いつ完了したか」が残りにくく, 確認漏れや引き継ぎ漏れにつながっていた.
- 店舗スタッフが普段使っているLINEから開ける画面にして, 新しい専用アプリを導入せずに使える形にした.
- MVPでは1店舗での導入に絞り, 日間, 週間, 月間の清掃チェックを毎日回せる状態を目指した.

## 技術選定と意図

- LIFF: 従業員がLINE上からチェック画面を開けるようにするために使う. LINEのログイン情報から表示名やユーザー情報も扱える.
- GitHub Pages: 画面は静的ファイルだけで動くので, サーバーを増やさず`pages/`をそのまま公開する.
- Firebase Auth: Firestoreへ書き込む人を識別するために使う. 管理者はEmail/Passwordでログインし, Firestoreの`stores/{storeId}/admins/{uid}`にUIDがあるかで判定する.
- Firestore: チェック状態を複数端末で共有する保存先. `checkedBy`と`checkedByUserId`により, 誰がチェックしたかも保存する.
- Firestore Rules: ブラウザからFirestoreへ直接書き込むため, 管理者だけができる操作と従業員ができるチェック更新をルールで分ける.
- GitHub Actions: Firebase Sparkで運用しやすくするため, Cloud FunctionsではなくActionsで10:35の日次タスク作成と00:35の未完了通知を動かす.
- LINE Messaging API: 未完了タスクを従業員へpush通知するために使う. 通知用のアクセストークンはGitHub Actions secretsで管理する.

## 構成

- API/バックエンド: Firestore直接書き込みとGitHub Actions(`scripts/`)
- 正本データ: Firestore
- フロントエンド: GitHub Pages(`pages/`)
- 管理者画面: GitHub Pages(`pages/admin.html`)
- Firestore: タスク, テンプレート, 日別実行項目, ユーザー, 管理者allowlistを保存

## 運用前提

- MVPは単一店舗運用を前提にし, 1ユーザー = 1店舗として扱う.
- 従業員画面でFirestoreを読む時とチェックを更新する時は, Firebase Authのログイン状態が必須.
- チェック記録は`checkedBy`にLINE表示名, `checkedByUserId`にFirebase Auth UIDを保存する.
- LIFFのLINE userIdは`liffUserId`として別保存し, `checkedByUserId`はFirebase Auth UIDとして扱う.
- 業務日の切替はJST10:30を境界にし, GitHub ActionsはJST10:35に当日分タスクを作成する.
- 未完了通知はGitHub ActionsでJST00:35に実行する.

## 運用手順

- 非IT担当者向けの現行運用説明書は[docs/operations/non-it-operator-guide.md](docs/operations/non-it-operator-guide.md)を参照してください.
- Firebase Spark主系の技術運用は[docs/operations/firebase-spark-primary.md](docs/operations/firebase-spark-primary.md)を参照してください.
- 旧GAS主系の参考資料は[docs/operations/bootstrap.md](docs/operations/bootstrap.md)に残っています.

## ディレクトリ

- [docs/](docs/)
- [pages/](pages/)
- [scripts/](scripts/)
- [tasks.md](tasks.md)


## ローカル準備
- Node.jsをインストール
- `npm ci`


## テスト
- `npm test`


## 必要な本番設定
- Firebase Authentication: Email/PasswordとAnonymousを有効化する.
- Firestore Rules: [docs/operations/firestore.rules](docs/operations/firestore.rules)を適用する.
- 管理者: Firebase AuthのUIDを`stores/store-hashimoto/admins/{uid}`に登録する.
- GitHub Actions secrets:
  - `FIREBASE_SERVICE_ACCOUNT_JSON`
  - `LINE_CHANNEL_ACCESS_TOKEN`
- GitHub Actions variables:
  - `STORE_ID`. 未設定時は`store-hashimoto`を使う.


## 自動処理
- `Deploy LIFF Pages`: `pages/`をGitHub Pagesへ公開する.
- `Daily start`: JST10:35に`scripts/daily-start.mjs`を実行し, 当日分タスクを作成する.
- `Incomplete reminder`: JST00:35に`scripts/incomplete-reminder.mjs`を実行し, 前日分の未完了通知を送る.


## Firestore同期
- チェック操作, テンプレート挿入, 日付内タスク削除はFirestoreへ直接保存する.
- リアルタイム同期用イベントは`stores/{storeId}/runs/{targetDate}/events/*`に保存する.
- 日別タスクは`stores/{storeId}/runs/{targetDate}/items/*`に保存する.
- 統計タブはFirestoreの日別データをクライアントで集計する.

## LIFF起動時間の計測
- `pages/`のURLに`?debugTiming=1`を付けると, 起動時間のウォーターフォールを画面下部とブラウザconsoleに表示する.
- 解除する場合は`localStorage.removeItem('ogawaya:debug-timing')`を実行する.
