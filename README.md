# 会社共有チェックリスト LINE Bot（GAS版）

`tasks.md` を正として実装を進めるリポジトリです。  
LINE Bot + LIFF + 日次バッチを Google Apps Script（GAS）と Spreadsheet で構成します。

## 確定仕様（tasks.md 準拠）
- 実装基盤は `GAS + LIFF + Spreadsheet`。
- 日次ジョブは2本。
  - 毎日10:30: 当日分チェックリスト作成と開始通知
  - 毎日0:00: 前日分未完了通知と締切処理
- 0:00未完了通知の送信対象は、対象店舗の従業員・管理者。
- 締切後も前日分チェックは可能。
- 初期版は `1ユーザー = 1店舗` 前提で運用する。複数店舗の横断閲覧は対象外。
- LINEメニューは共通で `今日のチェックリスト / 未完了一覧 / ヘルプ` を表示する。
- チェック実行者は `checked_by_name` に LINE の表示名で保存する。
- 性能目標は `today` 取得2秒以内、チェック操作1秒以内。

## 実装上の補足
- GAS Web App の `doPost(e)` は公式ドキュメント上ヘッダーを受け取らないため、LIFF の `idToken` はクエリパラメータ `idToken` として受け取り、サーバー側で LINE の verify API に送って `sub` を取得する。
- 現行運用は `LIFF( GitHub Pages ) + GAS API + Trigger` を前提とし、LINE Developers の `Use webhook` は `OFF` とする。
- Webhook を将来使う場合のみ、`X-Line-Signature` を `signature` クエリとして渡せる受信経路を別途用意する。
- GAS Web App は `GET` / `POST` だけを直接受けるため、`PUT` / `DELETE` は `_method` クエリでメソッドオーバーライドして扱う。
- `ALLOW_ANONYMOUS_ACCESS=true` は閲覧のフォールバック用途として残している。更新系APIは `idToken` 必須。
- MVP で `ALLOW_ANONYMOUS_ACCESS=true` の場合、当日チェックリストが未作成なら初回アクセス時に自動生成する。
- `DEBUG_EVENT_SHEET_ENABLED=false` のときは `debug_events` への追記を止め、実行速度を優先する（Cloud Logs は継続）。
- `SPREADSHEET_STATE_CACHE_ENABLED=true`（既定）で Spreadsheet state を ScriptCache に保持し、連続アクセス時の読み込みを短縮する。
- `SPREADSHEET_STATE_CACHE_TTL_SECONDS`（既定 `300`）で state cache の保持秒数を調整できる。
- `SPREADSHEET_STATE_CACHE_CHUNK_SIZE`（既定 `90000`）で cache 分割サイズを調整できる。
- API 実行ログ `api.request.success` / `api.request.failed` には `durationMs` が出るため、遅延の実測比較に使える。

## 目的
- 店舗別の日次チェックリストをLINE上で共有する。
- チェック・取消をその場で更新できるようにする。
- 10:30開始通知と0:00未完了通知を自動実行する。
- テンプレート編集は Spreadsheet 側の直接編集で運用する。

## 構成
- API/バックエンド: GAS (`gas/src/handlers`)
- ビジネスロジック: GAS (`gas/src/services`)
- 日次バッチ: GAS Trigger (`gas/src/scheduler`)
- データストア: Spreadsheet (`gas/src/storage`)
- LIFF フロント: GitHub Pages (`pages/`)
- LIFF 用テンプレート(互換保持): GAS (`gas/src/liff/user`)
- 共通設定: `gas/appsscript.json`, `gas/.clasp.json`
- テスト: Node 標準テストランナー (`tests/`)
- CI: GitHub Actions (`.github/workflows/test.yml`)

## ディレクトリ
- [gas/](/home/sota411/Documents/project/ogawaya/gas)
  - [gas/src/](/home/sota411/Documents/project/ogawaya/gas/src)
  - [gas/src/handlers/](/home/sota411/Documents/project/ogawaya/gas/src/handlers)
  - [gas/src/liff/user/](/home/sota411/Documents/project/ogawaya/gas/src/liff/user)
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
  - `tests/ui`: LIFF 共通初期化、更新ボタン
  - `tests/docs`: 仕様文書の必須記載

## デプロイ準備
1. [gas/.clasp.json](/home/sota411/Documents/project/ogawaya/gas/.clasp.json) の `scriptId` を設定する。
2. [gas/appsscript.json](/home/sota411/Documents/project/ogawaya/gas/appsscript.json) の必要権限（External Request / Spreadsheet）を設定する。
3. `gas/src` 配下の `.gs` を実装する。
4. `pages/config.json` に `gasApiBaseUrl` と `liffId` を設定する。
5. 複数端末の即時同期を使う場合は `pages/config.json` の `firebase`（`apiKey` / `authDomain` / `projectId` / `appId`）を設定する。
6. Script Properties に `ALLOW_ANONYMOUS_ACCESS` を設定する（`true` は閲覧のみフォールバック）。
7. `clasp push` で GAS を反映する。
8. GitHub Pages を有効化し、`Deploy LIFF Pages` ワークフローで `pages/` を公開する。
9. Trigger を2本作成する。
   - 10:30: `runDailyStart`
   - 0:00: `runDailyClosing`
10. LINE Developers の LIFF Endpoint URL を `https://<user>.github.io/<repo>/` に設定する。
11. LIFF URL（`https://liff.line.me/<LIFF_ID>`）をLINEリッチメニューに紐づける。
12. LINE Developers の `Use webhook` は `OFF` にする（任意機能として後から有効化可能）。

## リアルタイム同期（Firestore）
- 正本データは従来どおり GAS + Spreadsheet。Firestore は画面の同期イベント配信専用で使う。
- `pages/config.json` の `enableRealtimeSync=true` かつ `firebase` が有効なときだけリアルタイム同期が動作する。
- イベント配信先は `stores/{storeId}/runs/{targetDate}/events`。
- 画面側は Firestore 購読に加えて 30 秒周期の整合リフレッシュを実施する。
- Firestore Rules は [docs/operations/firestore.rules](/home/sota411/Documents/project/ogawaya/docs/operations/firestore.rules) を適用する。

詳細な初期データ投入と運用手順は [docs/operations/bootstrap.md](/home/sota411/Documents/project/ogawaya/docs/operations/bootstrap.md) を参照する。

## テスト運用（TDD）
- 実装順は `失敗するテスト追加 → 実装 → リファクタ` を厳守する。
- 各タスクで `正常系 / 異常系 / 境界値` を最低1件ずつ含める。
- `tests/` と `npm test` を固定の実行方法とする。
- CI でも `npm test` を実行する。

## 参照
- [tasks.md](/home/sota411/Documents/project/ogawaya/tasks.md) を実装の正とする。
- [要件定義書.md](/home/sota411/Documents/project/ogawaya/要件定義書.md) は `tasks.md` 準拠で更新する。
