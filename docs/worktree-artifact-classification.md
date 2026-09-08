# 作業ツリー成果物の分類

更新日: 2026-09-08 JST

## 適用範囲

分類開始時点の未追跡83ファイルを対象にした。分類のために追加したこの文書は
83ファイルには含まれない。既存ファイルの削除、移動、内容変更は行っていない。

分類は「コミットしてよい」という判断ではない。レビュー対象は、ロードマップの
作業単位ごとに分割し、検証してから個別に判断する。

## 分類結果

| 分類 | 件数 | 扱い |
| --- | ---: | --- |
| レビュー対象として保持 | 65 | Git statusに残し、機能単位へ分割してレビューする |
| 独立した開発ツール | 2 | Blogger製品変更と混ぜず、別の任意変更単位として扱う |
| ローカル運用証跡 | 10 | ファイルを保持したまま、明示的にGit管理外とする |
| 生成物・複製・キャッシュ | 6 | ファイルを保持したまま、明示的にGit管理外とする |
| 合計 | 83 | 分類漏れ・重複なし |

## レビュー対象として保持 — 65件

次の65件はGit statusに残す。ただし一括追加はしない。

- リポジトリ運用・指示・文書・例: 21件
  - `.codex/HANDOFF.md`
  - `AGENTS.md`、ルート`SKILLS.md`、`data/SKILLS.md`、
    `themes/SKILLS.md`
  - `docs/`の4件と`examples/`の4件
  - `scripts/SKILLS.md`
  - `src/`配下の7件の`SKILLS.md`
- 製品コードと通常テスト: 38件
  - `src/`配下の未追跡ファイルから、後述するカナリアテスト3件を
    除いたもの
- 再利用候補の運用・検証スクリプト: 6件
  - `scripts/combine-isolated-generation-results.mjs`
  - `scripts/generate-isolated-articles-with-total-budget.mjs`
  - `scripts/prepare-isolated-generation-batch.mjs`
  - `scripts/select-batch-items.mjs`
  - `scripts/verify-agent.ps1`
  - `scripts/test-verify-agent.ps1`

この分類の次段階で、Phase 7、読取専用Phase 8候補、変更系Phase 9候補、
プロセス基盤へ分ける。

## サニタイズ完了 — 5件（レビュー対象65件に含む）

次のテスト・フィクスチャに含まれていた実運用由来と見られるBloggerのブログID、
投稿ID、編集URLを架空値へ置換した。テストの同一性、不一致、連番の関係は維持した。

- `src/tests/draftPersistence.test.ts`
- `src/tests/fixtures/desk-gear-lab-02-empty-permalink.json`
- `src/tests/scheduledPermalinkAuditService.test.ts`
- `src/tests/scheduledPermalinkRepairPreparationService.test.ts`
- `src/tests/scheduledPostPersistenceGate.test.ts`

これらは製品テストとして有用なためGit除外しない。元の識別子が追跡済み・
未追跡のGit管理候補に残っていないことを確認し、対象4テストファイル25件が合格した。

## 独立した開発ツール — 2件

- `scripts/enrich_token_usage_report.py`
- `scripts/test_enrich_token_usage_report.py`

トークン／コンテキスト分析として完結しているが、Blogger製品ロードマップとは
独立している。製品機能を先送りして継続開発せず、採用する場合も別変更単位にする。
生成したCSV・JSONは追跡しない。

## ローカル運用証跡 — 10件

次のファイルは、対象固有のID・証跡ハッシュを含む一回限りのカナリア、または
新しいCLIに置き換えられた／特定goal向けの補助処理である。ファイルを削除せず、
`.gitignore`へ正確なパスを追加した。

- `.codex/inspect-permalink-controls-readonly.mjs`
- `scripts/audit-batch-drafts.mjs`
- `scripts/audit-content-with-deferred-images.mjs`
- `scripts/build-desk-gear-lab-02-canonical-v6.mjs`
- `scripts/run-blur-preview-permalink-only-canary.mjs`
- `scripts/run-keyboard-permalink-only-canary.mjs`
- `scripts/run-permalink-only-canary.mjs`
- `src/tests/blurPreviewPermalinkOnlyCanaryRunner.test.ts`
- `src/tests/keyboardPermalinkOnlyCanaryRunner.test.ts`
- `src/tests/permalinkOnlyCanaryRunner.test.ts`

除外は再実行の許可ではない。対象を固定した新しいgoal、最新の事前監査、機能フラグ、
許可リスト、STOP確認、ユーザーの明示承認がなければ再利用しない。

## 生成物・複製・キャッシュ — 6件

- `reports/`のCSV・JSON 4件
- `scripts/__pycache__/`のPython bytecode 1件
- ルートの`blogger-source.zip` 1件

`blogger-source.zip`はリポジトリ一式を含む重複スナップショットであり、製品ソースの
正本にしない。これらも削除せず、`.gitignore`へ限定的な規則を追加した。

## 次の作業単位

プロセス基盤21ファイルとPhase 7の27パスは、独立したレビュー単位として
確定した。次は既存下書き選定・完全監査、予約パーマリンク監査、公開監視を
読取専用のPhase 8候補として固定する。
