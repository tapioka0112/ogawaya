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
- `/api/link` は `employeeCode + passcode` を受け取り、`lineUserId` はLIFF認証コンテキストからサーバー側で取得する。
- `/api/link` のリクエストボディは `employeeCode` と `passcode` の2項目のみを受け付ける。
- 性能目標は `today` 取得2秒以内、チェック操作1秒以内。

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

## デプロイ準備
1. [gas/.clasp.json](/home/sota411/Documents/project/ogawaya/gas/.clasp.json) の `scriptId` を設定する。
2. [gas/appsscript.json](/home/sota411/Documents/project/ogawaya/gas/appsscript.json) の必要権限（External Request / Spreadsheet）を設定する。
3. `gas/src` 配下の `.gs` / `.html` を実装する。
4. `clasp push` で反映する。
5. Trigger を2本作成する。
   - 10:30: `runDailyStart`
   - 0:00: `runDailyClosing`
6. LIFF URLをLINEリッチメニューに紐づける。

## テスト運用（TDD）
- 実装順は `失敗するテスト追加 → 実装 → リファクタ` を厳守する。
- 各タスクで `正常系 / 異常系 / 境界値` を最低1件ずつ含める。
- `tasks.md` の「共通テスト基盤（事前準備）」完了までは、テストディレクトリと実行コマンドは未固定。固定後はこのREADMEに追記する。

## 参照
- [tasks.md](/home/sota411/Documents/project/ogawaya/tasks.md) を実装の正とする。
- [要件定義書.md](/home/sota411/Documents/project/ogawaya/要件定義書.md) は `tasks.md` 準拠で更新する。
