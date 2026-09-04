import { fileURLToPath } from "node:url";
import { defineCorpus, type CorpusConfig } from "@corpus/contract";
import { expect, test } from "vitest";
import { buildSnapshot } from "./build";

const REPO = fileURLToPath(new URL("../test/fixtures/repo", import.meta.url));

function withExec(command: string): CorpusConfig {
  return defineCorpus({
    project: "fixture-project",
    server: "https://corpus.example",
    sourceLanguage: "en",
    languages: ["en"],
    sources: [{ adapter: "exec", command }],
  });
}

test("an exec source merges its strings and entities", async () => {
  const snapshot = await buildSnapshot(withExec("node export.mjs"), REPO);
  expect(snapshot.strings.map((s) => s.id)).toContain("exec.greeting");
  expect(snapshot.entities.map((e) => e.id)).toContain("trait:brave");
});

test("a non-zero exit fails the build, naming the command", async () => {
  await expect(buildSnapshot(withExec("node fail.mjs"), REPO)).rejects.toThrow(
    /node fail\.mjs.*exited/s,
  );
});

test("non-JSON output fails the build, naming the command", async () => {
  await expect(buildSnapshot(withExec("node junk.mjs"), REPO)).rejects.toThrow(
    /node junk\.mjs.*JSON/s,
  );
});
