# Firebase Spark 主系運用

GAS と Firebase Functions は使わず、GitHub Pages、LIFF、Firebase Auth、Firestore、GitHub Actions で運用します。

## 必要な設定

- Firebase Authentication: Email/Password と Anonymous を有効化する。
- Firestore: `firebase/firestore.rules` をデプロイする。
- 管理者: Firebase Auth の管理者UIDを `stores/{storeId}/admins/{uid}` に作成する。
- GitHub Actions secrets:
  - `FIREBASE_SERVICE_ACCOUNT_JSON`
  - `LINE_CHANNEL_ACCESS_TOKEN`
- GitHub Actions variables:
  - `STORE_ID`。未設定時は `store-hashimoto` を使う。

## 日次処理

- `.github/workflows/daily-start.yml`
  - JST 10:35 に `scripts/daily-start.mjs` を実行する。
  - `stores/{storeId}/tasks` の active なタスクを当日の `runs/{date}/items` に作成する。日間は毎日、週間は日曜、月間は1日に作成する。
- `.github/workflows/incomplete-reminder.yml`
  - JST 00:35 に `scripts/incomplete-reminder.mjs` を実行する。
  - 前日の未完了タスクを `stores/{storeId}/users` の `liffUserId` へ LINE push する。

## 初期移行

CSV がある場合は次で Firestore へ投入する。

```sh
STORE_ID=store-hashimoto FIREBASE_SERVICE_ACCOUNT_JSON='...' node scripts/migrate-csv-to-firestore.mjs
```

管理者UIDは Firebase Auth のUIDを使うため、既存CSVの社員IDとは一致しません。Firebase Console で管理者ユーザーを作成後、そのUIDを `stores/{storeId}/admins/{uid}` に登録します。
