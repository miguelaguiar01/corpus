// The interface catalogue the screenshots stage, frozen (#531): the demo
// is Corpus translating Corpus, so every PR that adds an interface
// string moved the numbers in the images and no comparison was clean.
// `bin/screenshots --refresh-fixture` rewrites these two files from the
// live catalogue, a deliberate commit; the shots read them.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSnapshot, loadConfig } from "@corpus-tool/cli";
import type { Snapshot } from "@corpus/contract";

const REPO = fileURLToPath(new URL("../../..", import.meta.url));
const DIR = path.join(REPO, "docs/screenshots/fixture");
const SNAPSHOT = path.join(DIR, "chrome.snapshot.json");
const SEEDS = path.join(DIR, "chrome.pt-PT.json");

export function frozenChrome(): {
  snapshot: Snapshot;
  seeds: Record<string, string>;
} {
  try {
    return {
      snapshot: JSON.parse(readFileSync(SNAPSHOT, "utf8")) as Snapshot,
      seeds: JSON.parse(readFileSync(SEEDS, "utf8")) as Record<string, string>,
    };
  } catch {
    throw new Error(
      `no frozen interface catalogue under ${DIR}; run bin/screenshots --refresh-fixture`,
    );
  }
}

export async function refreshChrome(): Promise<void> {
  const config = await loadConfig(REPO);
  const snapshot = await buildSnapshot(config, REPO);
  mkdirSync(DIR, { recursive: true });
  writeFileSync(SNAPSHOT, `${JSON.stringify(snapshot, null, 2)}\n`);
  writeFileSync(
    SEEDS,
    readFileSync(path.join(REPO, "apps/web/src/i18n/messages.pt-PT.json")),
  );
  console.log(
    `screenshots: froze ${snapshot.strings.length} interface strings and their pt-PT seeds under docs/screenshots/fixture`,
  );
}

if (process.argv.includes("--refresh")) {
  refreshChrome().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
