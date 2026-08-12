# AI Blogger Content Automation

[![CI](https://github.com/sbty/blog_prototype/actions/workflows/ci.yml/badge.svg)](https://github.com/sbty/blog_prototype/actions/workflows/ci.yml)

現在の限定安定版: [v0.2.0](https://github.com/sbty/blog_prototype/releases/tag/v0.2.0)

現在のリポジトリ運用範囲は、ローカルで明示的に許可した専用Bloggerテストブログだけを対象とします。2ブログで一括予約・公開を受入確認済みですが、追加のBlogger実操作、無人公開、本番運用を許可するものではありません。

- [開発・PR手順](CONTRIBUTING.md)
- [変更履歴](CHANGELOG.md)
- [セキュリティーポリシーと非公開報告](SECURITY.md)
- [Code scanning](https://github.com/sbty/blog_prototype/security/code-scanning)

Google Blogger 向け AI ブログ自動運用システムです。下書き保存、予約証跡フロー、および専用テストブログ限定の予約実行境界を実装しています。予約実行はブログID、証跡ハッシュ、STOP、機能フラグ、一回限りマーカーで制限されます。

## 実装済み

- TypeScript strict mode の Node.js プロジェクト
- SQLite 初期化と最小スキーマ
- ブログ設定登録
- ジョブ作成、状態遷移、イベントログ
- STOP ファイルによる安全停止
- CLI
- Blogger dry-run
  - Blogger 管理画面を開く
  - 投稿画面を開く
  - タイトル、本文、ラベル、検索向け説明、スラッグ、予約日時を入力
  - スクリーンショットを保存
  - 下書き保存、公開、予約確定は実行しない

## セットアップ

Node.js 22 LTS または 24 LTS を使用してください。

```bash
npm install
cp .env.example .env
npm run build
npm test
```

Phase 2 のローカル完了条件は次の一括コマンドでも検証できます。

```bash
npm run verify:phase2
```

外部実行を行わず、最新のローカル実装と実行拒否境界まで一括検証する場合は次を実行します。

```bash
npm run verify:phase5-boundary
```

ローカル完了状態の最終確認には、同じ安全ゲートを呼び出す次の別名も使用できます。

```bash
npm run verify:local-complete
```

Windows PowerShell では `cp` の代わりに次を使えます。

```powershell
Copy-Item .env.example .env
```

## DB 初期化

```bash
npm run dev -- init-db
```

既定では `./data/app.sqlite` に作成されます。

## ブログ設定登録

```bash
npm run dev -- register-blog --blog examples/blog.example.json
```

本番ブログで使う前に `adminUrl`、`publicUrl`、`blogger.selectorsPath` を実環境に合わせてください。

PCパーツ・ガジェット・デスク用品ブログ向けの設定例は
examples/desk-gear-lab.blog.json、対応するBloggerテーマは
themes/desk-gear-lab-geek.xml にあります。どちらのURLとブログIDも架空値です。

用途別のブログ設定例も `examples/` にあります。

- `travel-rules-lab.blog.json`: 海外旅行の制度・ルール
- `global-app-spec-lab.blog.json`: 海外アプリ・Webサービスの仕様
- `game-platform-lab.blog.json`: ゲーム技術・ビジネス・プラットフォーム
- `japan-practical-answers.blog.json`: 外国人向けの日本制度・生活ルール（英語）
- `service-change-alternatives.blog.json`: サービス終了・仕様変更・代替サービス
- `compatibility-database.blog.json`: PC・家電・ゲーム機器の互換性
- `repair-maintenance-lab.blog.json`: DIY修理・メンテナンス
- `pc-game-troubleshooting.blog.json`: PC・ゲームのトラブルと設定

これらのURLとブログIDも架空値です。実際に登録する前に投稿先ブログの値へ差し替えてください。

## dry-run 実行

```bash
npm run dev -- dry-run --blog examples/blog.example.json --article examples/article.example.json
```

dry-run の成果物は `data/jobs/<jobId>/` に保存されます。

- `job.json`
- `article.json`
- `article.html`
- `dry-run.json`
- `screenshots/dry-run.png`

## 下書き保存

安全フラグを明示的に有効化した場合だけ、Blogger の保存ボタンをクリックします。公開ボタンや予約確定は操作しません。

```env
ENABLE_DRAFT_SAVE=true
ENABLE_SCHEDULED_POST=false
```

```bash
npm run dev -- save-draft --blog examples/blog.example.json --article examples/article.example.json
```

成果物として `draft.json` と `screenshots/draft-saved.png` を保存します。次の検証をすべて通過した場合だけ、ジョブ状態を `DRAFT_SAVED` に更新します。

- 保存前の同一タイトル監査で下書きが0件
- 保存後URLが HTTPS の Blogger 投稿編集URL
- 保存後URLのブログIDが設定したブログIDと一致
- 保存時刻が有効な日時
- 保存スクリーンショットが当該ジョブの成果物ディレクトリ内に実在し、空ではない

`draft.json` には保存結果に加えて `preSaveAudit` を記録します。

## 複数ブログ・複数記事バッチ

[`examples/batch.example.json`](examples/batch.example.json) のように、ブログ一覧と投稿記事一覧を1ファイルへまとめます。各記事の `blogKey` が投稿先ブログを指定します。入力全体を検証してから1件ずつ順番に処理し、結果を `data/jobs/<batchId>/batch-result.json` に保存します。

既定のサンプルは `operation: "dry-run"` です。Blogger投稿エディタへ記事を入力してスクリーンショットを取得しますが、保存ボタンは押しません。`ENABLE_DRY_RUN=true`、`ENABLE_DRAFT_SAVE=false`、`ENABLE_SCHEDULED_POST=false` で実行します。

```bash
npm run dev -- run-batch --manifest examples/batch.example.json
```

複数の下書きを保存する場合は `operation` を `save-drafts` に変更します。

```env
ENABLE_DRAFT_SAVE=true
ENABLE_SCHEDULED_POST=false
```

`continueOnError=true` では1件の失敗後も次の記事へ進みます。`false` では残りをスキップします。STOPファイルがある場合は常に残りを停止します。

予約計画を一括作成する場合は `operation` を `plan-schedules` に変更し、各記事へオフセット付きISO 8601形式の `scheduledAt` を指定します。この操作はローカル計画だけを作成し、Bloggerへ送信しません。両方の実行フラグを `false` にしてください。

## ローカル予約ワークフロー

Phase 3 の予約機能は、計画・承認・検証・通信遮断ブラウザプレビュー・取消までを実装しています。すべて `ENABLE_SCHEDULED_POST=false` で実行します。ブラウザプレビュー以外はBloggerを開きません。

### 1. 予約計画

記事JSONの `scheduledAt` を検証し、日次上限を確認して `READY_FOR_POST` ジョブを作成します。

```bash
npm run dev -- plan-schedule --blog examples/blog.example.json --article examples/article.example.json
```

成果物は `schedule-plan.json` です。

### 2. ローカル承認

誤承認防止のため、`--confirm` へ同じジョブIDを指定します。承認後は `APPROVED_FOR_POST` になります。

```bash
npm run dev -- approve-schedule --job <jobId> --confirm <jobId>
```

成果物は `schedule-approval.json` です。承認には計画ファイルの SHA-256 が記録されます。

### 3. 実行前チェック

承認状態、計画ハッシュ、予定時刻、DBの記事、現在の日次上限、STOP を再検証します。

```bash
npm run dev -- check-schedule --job <jobId>
```

成果物は `schedule-readiness.json` です。成功しても `executionEnabled=false` のままで、Blogger 操作は行いません。

### 4. 承認済みブラウザプレビュー

承認済み計画をもう一度検証してからBloggerエディタを開き、予約日時を含む記事内容を入力します。ページ遷移前から `POST`、`PUT`、`PATCH`、`DELETE` などを遮断するため、自動保存や予約確定は送信されません。

```bash
npm run dev -- preview-approved-schedule --job <jobId>
```

成果物は `schedule-browser-preview.json` と `screenshots/dry-run.png` です。スクリーンショットの実在・保存範囲と通信ガード集計を検証した場合だけ監査イベントを記録します。ジョブ状態は `APPROVED_FOR_POST` のままです。

このコマンドはBloggerへ接続します。ログイン画面、CAPTCHA、アクセス拒否、想定外ドメイン、別ブログの編集画面を検知した場合は入力前に停止します。

### 5. ブラウザプレビューの二重承認

`preview-approved-schedule` のCLI結果に表示される `previewArtifactSha256` とジョブIDを明示して、確認したプレビューを固定します。

```bash
npm run dev -- confirm-schedule-preview --job <jobId> --confirm <jobId> --preview-sha <previewArtifactSha256>
```

確認時には、プレビューJSON、計画、承認、スクリーンショット、通信遮断証跡を再検証します。成功すると `PREVIEW_CONFIRMED` になり、`schedule-preview-confirmation.json` を生成します。

`PREVIEW_CONFIRMED` は公開・予約確定の許可ではありません。成果物には `executionEnabled=false` と `bloggerMutationPerformed=false` を記録します。

### 6. 取消

未実行の計画を `CANCELLED` にし、日次予約枠を解放します。`PREVIEW_CONFIRMED` からも取消可能です。ジョブIDの完全一致確認が必要です。

```bash
npm run dev -- cancel-schedule --job <jobId> --confirm <jobId>
```

成果物は `schedule-cancellation.json` です。

状態遷移は次のとおりです。

```text
READY_FOR_POST -> APPROVED_FOR_POST -> 実行前チェック -> ブラウザプレビュー -> PREVIEW_CONFIRMED
       |                 |                                                        |
       +-----------------+----------------------> CANCELLED <---------------------+
```

予約確定の実行と証跡保存は実装済みです。DB上のジョブ状態は `PREVIEW_CONFIRMED` のまま保持し、完了判定は排他的な `schedule-execution-result.json` とジョブイベントを使います。

## STOP 機能

処理開始前に加え、下書き保存モードでは新規投稿の作成、タイトル・本文入力、投稿設定、予約日時プレビュー、画像処理内の各変更操作、保存クリックの直前に `data/STOP` を再確認します。存在する場合はジョブを停止し、以降の操作へ進みません。STOPファイルを確認できない権限エラーやI/Oエラーも安全側で停止します。

保存クリック直前には、ログイン切れ・CAPTCHA・アクセス拒否、対象ブログID、STOPをこの順で再検証します。下書き保存APIと画像アップローダーはSTOPガード未指定の直接呼び出しを拒否します。

```bash
New-Item data/STOP -ItemType File
```

再開する場合は `data/STOP` を削除してください。

## 安全フラグ

初期状態では dry-run のみ有効です。

```env
ENABLE_DRY_RUN=true
ENABLE_DRAFT_SAVE=false
ENABLE_SCHEDULED_POST=false
```

`ENABLE_DRAFT_SAVE` または `ENABLE_SCHEDULED_POST` が true の状態では dry-run は失敗します。誤投稿を避けるためです。

## Blogger セレクタ

Blogger UI の変更に備え、セレクタは `config/blogger-selectors.json` に分離しています。画面入力を確認する場合は、実保存を行わない dry-run とスクリーンショットを使用します。

## Phase 2 の状態

Phase 2 の下書き保存フローは実装済みです。画像アップロード、投稿設定、予約日時プレビュー、STOP 再確認、重複監査、保存結果と証跡の検証を自動テストで確認しています。

ローカル実装の完了条件と、専用テストブログで1件だけ実施した下書き保存受入結果は [`docs/phase2-completion-checklist.md`](docs/phase2-completion-checklist.md) に記録しています。

公開および予約確定は Phase 2 の対象外です。`ENABLE_SCHEDULED_POST=false` を維持してください。

## Phase 3 の状態

ローカル予約計画、日次上限、明示承認、SHA-256整合性確認、実行前再検証、通信遮断プレビュー、取消、および専用テストブログ限定の予約実行を実装済みです。画像付き単一記事の受入に加え、2つの専用テストブログへ各1件を同時刻に一括予約し、両方の公開を確認しました。

Phase 3 のローカル完了条件と、未実装の外部実行範囲は [`docs/phase3-completion-checklist.md`](docs/phase3-completion-checklist.md) に記録しています。

## Phase 4・5 の状態

Phase 4 では、計画・承認・ブラウザプレビュー・確認・スクリーンショットをSHA-256証跡チェーンへ結び付け、ローカル実行パッケージと監査証跡を排他的に生成します。これらの成果物は実行権限を付与しません。

Phase 5 の `execute-schedule` と一括実行は、Git管理外の `.env` で明示したBloggerブログID許可リストだけに制限されます。2つの専用テストブログで複数ブログ一括実行を受入済みですが、追加ブログや本番への実行許可を意味しません。完全一致するジョブ確認、パッケージ・監査SHA-256、STOP、相互排他的な機能フラグ、排他的な試行・再開マーカーを要求し、画像を公開確認より先にアップロードします。`npm run verify:local-complete` で検証します。

許可するブログIDは公開コードへ埋め込まず、Git管理外の `.env` に `AUTHORIZED_BLOG_IDS=<numeric-blog-id>,<numeric-blog-id>` として設定します。旧 `AUTHORIZED_TEST_BLOG_ID` は移行互換として利用できます。両方が空欄または未設定の場合、予約実行は安全側で拒否されます。公開用の設定例にあるブログIDとURLは架空値です。

予約実行直前にはBlogger公開フィードのUTCオフセットを読み取り、`APP_TIMEZONE` の期待オフセットと比較します。公開済み記事がある場合は最新記事の公開日時、空ブログではフィード更新日時を使用します。不一致、フィード取得失敗、不正JSON、検証可能な日時の欠落時は、試行マーカー作成およびブラウザ変更より前に停止します。

詳細は [`docs/phase4-completion-checklist.md`](docs/phase4-completion-checklist.md) と [`docs/phase5-boundary-checklist.md`](docs/phase5-boundary-checklist.md) を参照してください。Bloggerへの保存、予約確定、公開、または実行境界の解除には、別途明示的な承認と受入条件が必要です。

ローカル完了範囲の引き渡し要約は [`docs/local-completion-handoff.md`](docs/local-completion-handoff.md) にまとめています。

## Google ログインで「ログインできませんでした」が出る場合

Playwright 付属 Chromium で Google ログインを開くと、Google 側に「安全でないブラウザ」と判定されることがあります。ログイン突破を自動化せず、通常の Google Chrome と永続プロファイルを使ってください。

`.env` を次のように設定します。

```env
CHROME_CHANNEL=chrome
CHROME_EXECUTABLE_PATH=
CHROME_PROFILE_PATH=./data/chrome-profile
HEADLESS=false
```

まず通常の Chrome として専用プロファイルを開き、そこで手動ログインします。

```powershell
node dist\cli\index.js open-login --blog examples\blog.example.json
```

Blogger 管理画面まで進めたら、その Chrome ウィンドウを閉じます。その後 dry-run を実行してください。

```powershell
node dist\cli\index.js dry-run --blog examples\blog.example.json --article examples\article.example.json
```

以後は `./data/chrome-profile` にログイン状態が残ります。dry-run 中の Chrome で Google ログインをやり直すと、再びブロックされることがあります。

すでに普段使いの Chrome でログイン済みでも、通常の Chrome プロファイルを直接自動操作に使うのは避けてください。専用プロファイルを作る方が、誤操作やプロファイルロックを避けやすいです。

## Blogger 管理画面で止まる場合

`adminUrl` が投稿一覧の場合、dry-run は投稿編集 URL を自動生成します。

```json
"adminUrl": "https://www.blogger.com/blog/posts/1234567890123456789"
```

上記から次へ直接移動します。

```text
https://www.blogger.com/blog/post/edit/1234567890123456789
```

自動生成で合わない場合は `examples/blog.example.json` の `blogger` に `postEditorUrl` を明示してください。

```json
"blogger": {
  "selectorsPath": "./config/blogger-selectors.json",
  "postEditorUrl": "https://www.blogger.com/blog/post/edit/1234567890123456789"
}
```

失敗時は `data/jobs/<jobId>/screenshots/editor-not-found.png` または `body-editor-not-found.png` を確認してください。画面が投稿編集画面ではない、または Blogger UI のセレクタが変わっている可能性があります。

## 公開後の読取専用監査

ビルド後、公開ブログと画像を変更せずに受入結果を再確認できます。

```powershell
node dist/cli/index.js audit-published-post --blog examples/blog.example.json --article data/phase6-confirmation-acceptance-article.json
```

このコマンドは公開フィードで記事タイトルが完全一致する投稿が1件だけであること、本文が空でないこと、同一ブログの公開URLであること、画像が1件だけであること、画像が HTTP 200 かつ空でないことを確認します。データベースやBlogger管理画面への書き込みは行いません。

## 複数予約ジョブの一括承認・実行

`run-batch` の `plan-schedules` で作成した複数ジョブは、次のマニフェストで一括承認できます。例のジョブIDは架空値なので、実際のバッチ結果に記録されたIDへ置き換えてください。

```powershell
$env:ENABLE_DRAFT_SAVE='false'
$env:ENABLE_SCHEDULED_POST='false'
node dist/cli/index.js run-schedule-batch --manifest examples/schedule-approval-batch.example.json
```

承認後は、ブラウザプレビュー、プレビュー確認、実行パッケージ作成、独立監査の4段階を一括実行できます。この操作はBloggerの保存・公開を行いません。各段階で生成したSHA-256は自動的に次段階へ渡され、成功したジョブだけを含む `schedule-execution-batch.json` が結果ディレクトリに生成されます。

```powershell
$env:ENABLE_DRY_RUN='true'
$env:ENABLE_DRAFT_SAVE='false'
$env:ENABLE_SCHEDULED_POST='false'
node dist/cli/index.js run-schedule-batch --manifest examples/schedule-preparation-batch.example.json
```

準備結果の `executionManifestPath` に表示されたファイルを、そのまま次の一括実行へ指定できます。SHA-256の手入力は不要で、既存の証跡検証も省略しません。

```powershell
$env:AUTHORIZED_BLOG_IDS='1111111111111111111,2222222222222222222'
$env:ENABLE_DRAFT_SAVE='false'
$env:ENABLE_SCHEDULED_POST='true'
node dist/cli/index.js run-schedule-batch --manifest examples/schedule-execution-batch.example.json
```

`AUTHORIZED_BLOG_IDS` は `.env` にだけ置くカンマ区切りの許可リストです。未設定、許可外ブログ、証跡不一致、STOP、実行済みジョブはいずれもBlogger操作前に拒否されます。`execute-schedules` は全ジョブの状態、ブログ許可、証跡、予約時刻、実行・再開マーカー、公開URLとタイムゾーンを最初に一括検査し、1件でも不備があればバッチ成果物の作成前かつ最初のBlogger操作前に全体を拒否します。全体検査後も各記事の直前に同じ条件を再検証します。旧 `AUTHORIZED_TEST_BLOG_ID` も移行互換として利用できます。結果は `data/jobs/<batchId>/schedule-batch-result.json` に保存されます。通常の失敗は既定で次項目へ継続し、`continueOnError: false` またはSTOPでは残りをスキップします。実行開始後に失敗またはスキップされた項目がある場合、元の操作種別・確認値・SHA証跡を保持した `schedule-batch-retry.json` を同じディレクトリへ生成し、結果の `retryManifestPath` に記録します。このファイルはそのまま `run-schedule-batch --manifest` へ渡せます。全件事前検査で拒否された場合は成果物を作らないため、元マニフェストまたは設定を修正して再検査します。

## 予約バッチ結果の検査

`run-schedule-batch` の結果に表示された `batchId` を指定すると、DBやBloggerを書き換えずに結果JSON、実行JSON、再試行JSONの件数・順序・ジョブID・SHA証跡を照合できます。結果は `COMPLETED`、`RETRY_AVAILABLE`、`ATTENTION` のいずれかです。

```powershell
node dist/cli/index.js inspect-schedule-batch --batch <batchId>
```

`batchId` が分からない場合は、全予約バッチを完了日時の新しい順に一覧表示できます。不正な結果は他のバッチを妨げず `INVALID` として表示されます。

```powershell
node dist/cli/index.js list-schedule-batches
```

## キャンペーン単位の予約準備

複数ブログと複数記事を1つのJSONにまとめ、予約計画、ローカル承認、ブラウザプレビュー、プレビュー確認、実行パッケージ作成、独立監査までを1コマンドで処理できます。

ジョブや成果物を作る前に、キャンペーン全体だけを読み取り検査できます。全記事の予約日時、同日件数上限、ブログの `publicUrl`、セレクタ設定、画像ファイル、安全フラグをまとめて確認し、ブラウザやBloggerは開きません。ブログIDの実行許可が未設定の場合は警告になりますが、準備自体は可能です。

```powershell
node dist/cli/index.js validate-campaign --manifest examples/schedule-campaign.example.json
```

```powershell
$env:ENABLE_DRY_RUN='true'
$env:ENABLE_DRAFT_SAVE='false'
$env:ENABLE_SCHEDULED_POST='false'
node dist/cli/index.js prepare-campaign --manifest examples/schedule-campaign.example.json
```

`prepare-campaign` は最初に同じ全体検査を自動実行し、合格結果を `schedule-campaign-preflight.json` に保存します。`prepare-campaign` 自体が、マニフェストに列挙した記事のローカル承認操作です。Bloggerの投稿保存や予約確定は行わず、ブラウザ通信の変更リクエストも遮断されます。全項目を事前検証し、通常は1記事が失敗しても後続を続けます。`continueOnError: false` またはSTOPの場合は残りをスキップします。

成功した記事だけを含む `schedule-execution-batch.json` がキャンペーン結果ディレクトリへ自動生成されます。内容を確認した後、明示的に `ENABLE_SCHEDULED_POST=true` と許可ブログIDを設定し、次のコマンドへ渡すと最終実行できます。

```powershell
node dist/cli/index.js run-schedule-batch --manifest <executionManifestPath>
```

サンプルのブログID、URL、記事、日時はすべて架空値です。実行前にローカル設定へ置き換えてください。

途中失敗またはSTOPがある場合は、結果の `retryManifestPath` に `schedule-campaign-retry.json` が生成されます。同じ `prepare-campaign` コマンドへこのファイルを渡すと、計画済みの記事は既存ジョブの安全な状態から再開し、未計画の記事だけを新規計画します。既存ジョブとブログ設定・記事内容が一致しない場合や、取消済み・完了済みなど再開不能な状態では拒否されます。作成済みのプレビュー、パッケージ、監査証跡は検証して再利用されます。

## キャンペーン状態の検査

`prepare-campaign` の結果に表示された `campaignId` を指定すると、DBやBloggerを書き換えずに現在の状態を検査できます。

```powershell
node dist/cli/index.js inspect-campaign --campaign <campaignId>
```

各記事は `READY_TO_EXECUTE`、`RETRY_AVAILABLE`、`EXECUTED`、`EVIDENCE_INVALID`、`JOB_MISSING`、`JOB_STATE_INVALID`、`NEEDS_ATTENTION` のいずれかに分類されます。キャンペーン結果の件数、実行用JSON、再試行用JSON、ジョブID、パッケージ・監査SHA、実行結果JSONも照合します。このコマンドはSTOP中でも利用できる読み取り専用診断です。

## キャンペーン一覧

キャンペーンIDが分からない場合は、すべてのキャンペーンを完了日時の新しい順に確認できます。

```powershell
node dist/cli/index.js list-campaigns
```

一覧の状態は `READY_TO_EXECUTE`、`RETRY_AVAILABLE`、`COMPLETED`、`ATTENTION`、`EMPTY`、`INVALID` のいずれかです。`ATTENTION` は証跡・ジョブ・マニフェストのいずれかに確認事項がある状態、`INVALID` はキャンペーン結果自体を安全に読み取れない状態です。最大1,000キャンペーンまでを対象とし、DB・成果物・Bloggerは変更しません。
