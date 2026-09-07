export const problematicFirstOperationalBatch16 = [
  "compatibility-database-01",
  "compatibility-database-02",
  "desk-gear-lab-01",
  "desk-gear-lab-02",
  "game-platform-lab-01",
  "game-platform-lab-02",
  "global-app-spec-lab-01",
  "global-app-spec-lab-02",
  "pc-game-troubleshooting-01",
  "pc-game-troubleshooting-02",
  "repair-maintenance-lab-01",
  "repair-maintenance-lab-02",
  "service-change-alternatives-01",
  "service-change-alternatives-02",
  "travel-rules-lab-01",
  "travel-rules-lab-02"
] as const;

// Exact markers found in the 16 saved drafts after the length-only remediation.
// Keep this small fixture independent from mutable operational data and credentials.
export const problematicGenericBoilerplate = `
  <section><h2>まずは対象を固定して確認する</h2>
  <p>名称が似ていても製品型番、ソフトウェアの版、利用地域、利用時点によって前提が変わります。</p>
  <p>今回自分が使う機器・アカウント・旅程を一つずつ書き出します。</p></section>
  <section><h2>確認手順を分ける</h2><p>確認した日時も控えておくと後で見直しやすくなります。</p></section>
  <section><h2>実行前の最終チェックリスト</h2><p>対象が一致しているかを確認します。</p></section>`;
