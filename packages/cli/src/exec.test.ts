import { fileURLToPath } from "node:url";
import { defineCorpus, type CorpusConfig } from "@corpus/contract";
import { expect, test } from "vitest";
import { buildSnapshot } from "./build";
import { expandSources } from "./config";

const REPO = fileURLToPath(new URL("../test/fixtures/repo", import.meta.url));

function withExec(command: string, languages = ["en"]): CorpusConfig {
  return expandSources(
    defineCorpus({
      project: "fixture-project",
      server: "https://corpus.example",
      sourceLanguage: "en",
      languages,
      sources: [{ adapter: "exec", command }],
    }),
    REPO,
  );
}

test("an exec source merges its strings and entities", async () => {
  const snapshot = await buildSnapshot(withExec("node export.mjs"), REPO);
  expect(snapshot.strings.map((s) => s.id)).toContain("exec.greeting");
  // Exec entries carry no file (§4), whatever the exporter emitted.
  expect(
    snapshot.strings.find((s) => s.id === "exec.greeting")?.file,
  ).toBeUndefined();
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

test("an exporter's translations travel as seeds: the snapshot's ids only, never empty", async () => {
  const snapshot = await buildSnapshot(
    withExec("node export-seeds.mjs", ["en", "pt-PT"]),
    REPO,
  );
  expect(snapshot.seedTranslations).toEqual({
    "pt-PT": { "exec.greeting": "Bem-vindo, {who}." },
  });
  // An exporter that says nothing about translations seeds nothing.
  const plain = await buildSnapshot(
    withExec("node export.mjs", ["en", "pt-PT"]),
    REPO,
  );
  expect("seedTranslations" in plain).toBe(false);
});

test("translations for the source language or an undeclared one fail the build, naming the command", async () => {
  await expect(
    buildSnapshot(withExec("node export-seeds-bad.mjs", ["en", "pt-PT"]), REPO),
  ).rejects.toThrow(
    /export-seeds-bad\.mjs" emitted translations for the source language en[\s\S]*export-seeds-bad\.mjs" emitted translations for fr, which the config does not declare/,
  );
  await expect(
    buildSnapshot(
      withExec("node export-seeds-junk.mjs", ["en", "pt-PT"]),
      REPO,
    ),
  ).rejects.toThrow(/export-seeds-junk\.mjs" emitted invalid translations/);
});
