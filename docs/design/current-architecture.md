# 現在アーキテクチャ（2026-04-23）

## 図ファイル
- draw.io: [current-architecture.drawio](/home/sota411/Documents/project/ogawaya/docs/design/current-architecture.drawio)
- SVG: [current-architecture.svg](/home/sota411/Documents/project/ogawaya/docs/design/current-architecture.svg)
- 元spec(YAML): [current-architecture.spec.yaml](/home/sota411/Documents/project/ogawaya/docs/design/current-architecture.spec.yaml)

## 構成要点
- フロント配信は `GitHub Pages (pages/index.html + app.js)`。
- API本体・日次処理は `GAS Web App`。
- 正本データは `Google Spreadsheet`。
- `Firestore` は realtime 同期（events）と表示キャッシュ（snapshots）のみ。
- 通知は `GAS -> LINE Messaging API`。
