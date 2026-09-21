import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { checkFiles, findLiterals } from "./check";

describe("findLiterals", () => {
  test("flags JSX text with letters and user-facing string props", () => {
    const source = `
      export function Page() {
        return (
          <main title="Project settings">
            <h1>Catalogue</h1>
            <input placeholder="Search source text…" aria-label="Search" />
            <img alt="Logo" src="/x.png" />
          </main>
        );
      }`;
    expect(
      findLiterals(source, "page.tsx").map((f) => [f.line, f.text]),
    ).toEqual([
      [4, "Project settings"],
      [5, "Catalogue"],
      [6, "Search source text…"],
      [6, "Search"],
      [7, "Logo"],
    ]);
  });

  test("ignores catalog calls, code-only strings, punctuation, and non-user-facing props", () => {
    const source = `
      import { t } from "@/i18n";
      const key = "nav.catalogue";
      export function Nav({ slug }: { slug: string }) {
        return (
          <nav className="flex gap-4" data-testid="nav">
            <a href={\`/p/\${slug}\`}>{t("nav.overview")}</a>
            <span>{" · "}</span>
            <span>—</span>
            <b>{slug}</b>
          </nav>
        );
      }`;
    expect(findLiterals(source, "nav.tsx")).toEqual([]);
  });

  test("flags a string literal inside a JSX expression container", () => {
    const source = `export const X = () => <p>{"Nothing here yet."}</p>;`;
    expect(findLiterals(source, "x.tsx").map((f) => f.text)).toEqual([
      "Nothing here yet.",
    ]);
  });

  test("a string in braces as a prop's value follows the prop rule, not the child rule", () => {
    const source = `
      export const X = () => (
        <Stack align={"start"} size={"sm"} c={"dimmed"} title={"Project settings"}>
          <Text variant={\`subtle\`}>{"Loading dashboard"}</Text>
        </Stack>
      );`;
    expect(findLiterals(source, "x.tsx").map((f) => f.text)).toEqual([
      "Project settings",
      "Loading dashboard",
    ]);
  });

  test("a react-i18next Trans element's children and props are the key, not findings; text beside it still is", () => {
    const source = `
      import { Trans } from "react-i18next";
      export function Page({ name }: { name: string }) {
        return (
          <section title="Documents">
            <Trans>Delete document</Trans>
            <Trans i18nKey="shared" title="Shared with you">
              Hello <strong>{name}</strong>, {"welcome back"}
            </Trans>
            <I18n.Trans>Nested member</I18n.Trans>
            <p>Stray</p>
          </section>
        );
      }`;
    expect(findLiterals(source, "page.tsx").map((f) => f.text)).toEqual([
      "Documents",
      "Stray",
    ]);
  });

  test("an allow pattern silences matching texts", () => {
    const source = `export const X = () => <p>Corpus</p>;`;
    expect(findLiterals(source, "x.tsx", { allow: [/^Corpus$/] })).toEqual([]);
  });

  test("a corpus-ignore comment on the line before silences it", () => {
    const source = `export const X = () => (
      <p>
        {/* corpus-ignore */}
        Brand name
      </p>
    );`;
    expect(findLiterals(source, "x.tsx")).toEqual([]);
  });
});

describe("checkFiles", () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test("walks the include directories, skips ignores, and reports file:line", () => {
    dir = mkdtempSync(path.join(os.tmpdir(), "corpus-check-"));
    mkdirSync(path.join(dir, "src", "components"), { recursive: true });
    mkdirSync(path.join(dir, "src", "generated"), { recursive: true });
    mkdirSync(path.join(dir, "node_modules", "x"), { recursive: true });
    writeFileSync(
      path.join(dir, "src", "components", "a.tsx"),
      `export const A = () => <h1>Hello there</h1>;\n`,
    );
    writeFileSync(
      path.join(dir, "src", "components", "b.ts"),
      `export const b = "not jsx";\n`,
    );
    writeFileSync(
      path.join(dir, "src", "generated", "g.tsx"),
      `export const G = () => <p>Generated text</p>;\n`,
    );
    writeFileSync(
      path.join(dir, "node_modules", "x", "n.tsx"),
      `export const N = () => <p>Dependency text</p>;\n`,
    );
    const { findings, scanned } = checkFiles(dir, {
      include: ["src", "missing"],
      ignore: ["src/generated"],
    });
    expect(scanned).toEqual(["src"]);
    expect(findings.map((f) => `${f.file}:${f.line}: ${f.text}`)).toEqual([
      "src/components/a.tsx:1: Hello there",
    ]);
  });
});

test("ignore entries may be globs; a plain entry is still a prefix", async () => {
  const { ignoreMatcher } = await import("./check");
  const ignored = ignoreMatcher([
    "**/*.test.tsx",
    "src/legacy",
    "src/*.stories.tsx",
    "fixtures/**",
  ]);
  expect(ignored("src/components/button.test.tsx")).toBe(true);
  expect(ignored("button.test.tsx")).toBe(true);
  expect(ignored("src/components/button.tsx")).toBe(false);
  expect(ignored("src/legacy")).toBe(true);
  expect(ignored("src/legacy/old.tsx")).toBe(true);
  expect(ignored("src/legacy-two/x.tsx")).toBe(false);
  expect(ignored("src/card.stories.tsx")).toBe(true);
  expect(ignored("src/deep/card.stories.tsx")).toBe(false);
  expect(ignored("fixtures")).toBe(true);
  expect(ignored("fixtures/a/b.tsx")).toBe(true);
  // Literal text is never re-read as a pattern, whatever it contains.
  const odd = ignoreMatcher(["src/(a)/@@DIRS@@/*.tsx", "src/x+y?.tsx"]);
  expect(odd("src/(a)/@@DIRS@@/b.tsx")).toBe(true);
  expect(odd("src/a/b.tsx")).toBe(false);
  expect(odd("src/x+y1.tsx")).toBe(true);
  expect(odd("src/x+y12.tsx")).toBe(false);
});

test("check says when none of the included directories exists, instead of a clean bill", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } =
    await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { run } = await import("./cli");
  const dir = mkdtempSync(path.join(os.tmpdir(), "corpus-check-"));
  try {
    mkdirSync(path.join(dir, "i18n"));
    writeFileSync(path.join(dir, "i18n", "en.json"), "{}\n");
    writeFileSync(
      path.join(dir, "corpus.config.mjs"),
      `export default { project: "p", server: "http://localhost:3000", sourceLanguage: "en", languages: ["en"], sources: [{ adapter: "messages", type: "chrome", path: "i18n/{lang}.json" }] };\n`,
    );
    const out: string[] = [];
    const err: string[] = [];
    const code = await run(["check"], {
      cwd: dir,
      env: {},
      out: (l) => out.push(l),
      err: (l) => err.push(l),
    });
    expect(code).toBe(1);
    expect(out).toEqual([]);
    expect(err.join("\n")).toMatch(
      /check scanned nothing: none of src exists; set check\.include/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check hints at check.allow when most findings are single words or names", async () => {
  const { run } = await import("./cli");
  const dir = mkdtempSync(path.join(os.tmpdir(), "corpus-check-"));
  const check = async (lines: string[]) => {
    writeFileSync(
      path.join(dir, "src", "a.tsx"),
      `export const A = () => <>${lines.map((l) => `<p>${l}</p>`).join("")}</>;\n`,
    );
    const err: string[] = [];
    await run(["check"], {
      cwd: dir,
      env: {},
      out: () => {},
      err: (l) => err.push(l),
    });
    return err.join("\n");
  };
  try {
    mkdirSync(path.join(dir, "i18n"));
    mkdirSync(path.join(dir, "src"));
    writeFileSync(path.join(dir, "i18n", "en.json"), "{}\n");
    writeFileSync(
      path.join(dir, "corpus.config.mjs"),
      `export default { project: "p", server: "http://localhost:3000", sourceLanguage: "en", languages: ["en"], sources: [{ adapter: "messages", type: "chrome", path: "i18n/{lang}.json" }] };\n`,
    );
    const names = ["Nvidia", "AMD", "HEVC", "Intel", "VP9", "AV1"];
    const sentences = [
      "Save the file",
      "Open a door",
      "Close it now",
      "Try again later",
    ];
    const hinted = await check([...names, ...sentences]);
    expect(hinted).toMatch(
      /corpus: 6 of the 10 findings are single words or names; a name that stays untranslated goes in check\.allow \(regular expressions\)/,
    );
    expect(hinted).toMatch(/10 user-facing literal\(s\) outside/);
    expect(
      await check([
        ...names.slice(0, 4),
        ...sentences,
        "One more line",
        "And another",
      ]),
    ).not.toMatch(/check\.allow/);
    expect(await check(names.slice(0, 3))).not.toMatch(/check\.allow/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
