# 会社共有チェックリスト LINE Bot（GAS版）

`tasks.md` を正として実装を進めるリポジトリです。  
LINE Bot + LIFF + 日次バッチを Google Apps Script（GAS）と Spreadsheet で構成します。

## 確定仕様（tasks.md 準拠）
- 実装基盤は `GAS + LIFF + Spreadsheet`。
- 日次ジョブは2本。
  - 毎日10:30: 当日分チェックリスト作成と開始通知
  - 毎日0:00: 前日分未完了通知と締切処理
- 0:00未完了通知の送信対象は、対象店舗の従業員・管理者。
- 締切後も前日分チェックは可能。履歴で締切後操作を識別する。
- 初期版は `1ユーザー = 1店舗` 前提で運用する。複数店舗の横断閲覧は対象外。
- ロールは `part_time / manager / admin`。業務上は `part_time=アルバイト`、`manager=店長・部署責任者`、`admin=本部担当者` として扱う。
- LINEメニューは全ロール共通で `今日のチェックリスト / 未完了一覧 / 履歴を見る / ヘルプ` を表示する。
- `/api/link` は `employeeCode + passcode` を受け取り、`lineUserId` は LIFF 認証コンテキストからサーバー側で取得する。
- `/api/link` のリクエストボディは `employeeCode` と `passcode` の2項目のみを受け付ける。
- 性能目標は `today` 取得2秒以内、チェック操作1秒以内。

## 実装上の補足
- GAS Web App の `doPost(e)` は公式ドキュメント上ヘッダーを受け取らないため、LIFF の `idToken` はクエリパラメータ `idToken` として受け取り、サーバー側で LINE の verify API に送って `sub` を取得する。
- 現行運用は `LIFF + API + Trigger` を前提とし、LINE Developers の `Use webhook` は `OFF` とする。
- Webhook を将来使う場合のみ、`X-Line-Signature` を `signature` クエリとして渡せる受信経路を別途用意する。
- `users` シートには `/api/link` 用の `passcode` 列を持たせる。
- GAS Web App は `GET` / `POST` だけを直接受けるため、`PUT` / `DELETE` は `_method` クエリでメソッドオーバーライドして扱う。
- MVP では `ALLOW_ANONYMOUS_ACCESS=true` で LIFF 認証をスキップし、`users` の既存アカウント（優先順位: `admin > manager > part_time`）を実行ユーザーとして扱える。
- MVP で `ALLOW_ANONYMOUS_ACCESS=true` の場合、当日チェックリストが未作成なら初回アクセス時に自動生成する。

## 目的
- 店舗別の日次チェックリストをLINE上で共有する。
- チェック・取消・履歴を時系列で記録する。
- 10:30開始通知と0:00未完了通知を自動実行する。
- 管理者向け操作（テンプレート管理、項目CRUD、手動通知）を提供する。

## 構成
- API/バックエンド: GAS (`gas/src/handlers`)
- ビジネスロジック: GAS (`gas/src/services`)
- 日次バッチ: GAS Trigger (`gas/src/scheduler`)
- データストア: Spreadsheet (`gas/src/storage`)
- LIFF: GAS Web App (`gas/src/liff/user`, `gas/src/liff/admin`)
- 共通設定: `gas/appsscript.json`, `gas/.clasp.json`
- テスト: Node 標準テストランナー (`tests/`)
- CI: GitHub Actions (`.github/workflows/test.yml`)

## ディレクトリ
- [gas/](/home/sota411/Documents/project/ogawaya/gas)
  - [gas/src/](/home/sota411/Documents/project/ogawaya/gas/src)
  - [gas/src/handlers/](/home/sota411/Documents/project/ogawaya/gas/src/handlers)
  - [gas/src/liff/user/](/home/sota411/Documents/project/ogawaya/gas/src/liff/user)
  - [gas/src/liff/admin/](/home/sota411/Documents/project/ogawaya/gas/src/liff/admin)
  - [gas/src/services/](/home/sota411/Documents/project/ogawaya/gas/src/services)
  - [gas/src/scheduler/](/home/sota411/Documents/project/ogawaya/gas/src/scheduler)
  - [gas/src/storage/](/home/sota411/Documents/project/ogawaya/gas/src/storage)
  - [gas/src/shared/](/home/sota411/Documents/project/ogawaya/gas/src/shared)
- [docs/](/home/sota411/Documents/project/ogawaya/docs)
- [scripts/](/home/sota411/Documents/project/ogawaya/scripts)
- [tasks.md](/home/sota411/Documents/project/ogawaya/tasks.md)
- [要件定義書.md](/home/sota411/Documents/project/ogawaya/要件定義書.md)

## 設計資料
- [docs/design/architecture.md](/home/sota411/Documents/project/ogawaya/docs/design/architecture.md)
- [docs/design/state-transitions.md](/home/sota411/Documents/project/ogawaya/docs/design/state-transitions.md)

## ローカル準備
- `node` をインストールする。
- `clasp` をインストールする。
  - `npm i -g @google/clasp`
- `clasp` にログインする。
  - `clasp login`

## ローカルテスト
- テスト基盤は `tests/` 配下に配置している。
- 実行コマンドは `npm test`。
- 主な対象:
  - `tests/gas`: デプロイ前チェック、Spreadsheet 制約、API、Webhook、Scheduler、性能
  - `tests/ui`: LIFF 共通初期化、ロール分岐、更新ボタン
  - `tests/docs`: 仕様文書の必須記載

## デプロイ準備
1. [gas/.clasp.json](/home/sota411/Documents/project/ogawaya/gas/.clasp.json) の `scriptId` を設定する。
2. [gas/appsscript.json](/home/sota411/Documents/project/ogawaya/gas/appsscript.json) の必要権限（External Request / Spreadsheet）を設定する。
3. `gas/src` 配下の `.gs` / `.html` を実装する。
4. Script Properties に `ALLOW_ANONYMOUS_ACCESS` を設定する（MVPは `true` 推奨）。
5. `clasp push` で反映する。
6. Trigger を2本作成する。
   - 10:30: `runDailyStart`
   - 0:00: `runDailyClosing`
7. LIFF URLをLINEリッチメニューに紐づける。
8. LINE Developers の `Use webhook` は `OFF` にする（任意機能として後から有効化可能）。

詳細な初期データ投入と運用手順は [docs/operations/bootstrap.md](/home/sota411/Documents/project/ogawaya/docs/operations/bootstrap.md) を参照する。

## テスト運用（TDD）
- 実装順は `失敗するテスト追加 → 実装 → リファクタ` を厳守する。
- 各タスクで `正常系 / 異常系 / 境界値` を最低1件ずつ含める。
- `tests/` と `npm test` を固定の実行方法とする。
- CI でも `npm test` を実行する。

## 参照
- [tasks.md](/home/sota411/Documents/project/ogawaya/tasks.md) を実装の正とする。
- [要件定義書.md](/home/sota411/Documents/project/ogawaya/要件定義書.md) は `tasks.md` 準拠で更新する。
