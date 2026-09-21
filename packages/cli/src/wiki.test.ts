// The wiki's example configs are the CLI's input, so they are checked
// the way a client repository's config is: loaded and validated. A page
// that shows a config a user cannot run is worse than no page.
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { corpusConfigSchema } from "@corpus/contract";
import { createJiti } from "jiti";
import { expect, test } from "vitest";

const examples = fileURLToPath(
  new URL("../../../docs/wiki/examples", import.meta.url),
);

test("every config the wiki shows is a config the CLI accepts", async () => {
  const jiti = createJiti(import.meta.url);
  const configs = readdirSync(examples).filter((name) =>
    name.endsWith(".config.ts"),
  );
  expect(configs.length).toBeGreaterThan(0);
  for (const name of configs) {
    const loaded = await jiti.import(path.join(examples, name), {
      default: true,
    });
    const parsed = corpusConfigSchema.safeParse(loaded);
    expect(parsed.success, `${name}: ${parsed.error?.issues[0]?.message}`).toBe(
      true,
    );
  }
});
