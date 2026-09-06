import { fileURLToPath } from "node:url";
import {
  defineCorpus,
  snapshotSchema,
  type CorpusConfig,
} from "@corpus/contract";
import { expect, test } from "vitest";
import { buildSnapshot } from "./build";

const REPO = fileURLToPath(new URL("../test/fixtures/repo", import.meta.url));

function config(
  overrides: Partial<Parameters<typeof defineCorpus>[0]> = {},
): CorpusConfig {
  return defineCorpus({
    project: "fixture-project",
    server: "https://corpus.example",
    sourceLanguage: "en",
    languages: ["en", "pt-PT"],
    sources: [
      { adapter: "messages", type: "chrome", path: "i18n/{lang}.json" },
      {
        adapter: "table",
        type: "tutorial-step",
        path: "steps.ts",
        map: { id: "id", text: "text" },
      },
    ],
    ...overrides,
  });
}

test("builds a valid snapshot from messages + table sources", async () => {
  const snapshot = await buildSnapshot(config(), REPO);
  expect(snapshotSchema.safeParse(snapshot).success).toBe(true);
  expect(snapshot.project).toBe("fixture-project");
  const ids = snapshot.strings.map((s) => s.id);
  expect(ids).toEqual(["app.title", "greeting", "step-1", "step-2"]);
});

test("messages resolve {lang} to the source language", async () => {
  const snapshot = await buildSnapshot(config(), REPO);
  const greeting = snapshot.strings.find((s) => s.id === "greeting");
  expect(greeting?.source).toBe("Olá {name}");
  expect(greeting?.type).toBe("chrome");
});

test("table unmapped fields become metadata", async () => {
  const snapshot = await buildSnapshot(config(), REPO);
  const step = snapshot.strings.find((s) => s.id === "step-1");
  expect(step?.metadata).toEqual({ scene: "intro" });
});

test("a duplicate id across sources errors naming both sources", async () => {
  const dup = config({
    sources: [
      { adapter: "messages", type: "chrome", path: "i18n/{lang}.json" },
      {
        adapter: "table",
        type: "t",
        path: "collide.ts",
        map: { id: "id", text: "text" },
      },
    ],
  });
  await expect(buildSnapshot(dup, REPO)).rejects.toThrow(
    /duplicate id.*app\.title/s,
  );
});

test("invalid ICU in a source errors with the file path and key", async () => {
  const bad = config({
    sources: [{ adapter: "messages", type: "chrome", path: "bad/{lang}.json" }],
  });
  await expect(buildSnapshot(bad, REPO)).rejects.toThrow(
    /bad\/en\.json.*broken/s,
  );
});

test("the config's string and entity type declarations travel in the snapshot", async () => {
  const declared = config({
    stringTypes: {
      chrome: {
        tone: {
          type: "enum",
          description: "How the line reads.",
          values: ["plain", "urgent"],
        },
      },
    },
    entityTypes: { room: { label: "Room" } },
  });
  const snapshot = await buildSnapshot(declared, REPO);
  expect(snapshot.stringTypes).toEqual(declared.stringTypes);
  expect(snapshot.entityTypes).toEqual(declared.entityTypes);
  const bare = await buildSnapshot(config(), REPO);
  expect("stringTypes" in bare).toBe(false);
});
