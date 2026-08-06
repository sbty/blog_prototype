#!/usr/bin/env node

async function launch(): Promise<void> {
  const { main } = await import("./operationalCli.js");
  await main();
}

launch().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
