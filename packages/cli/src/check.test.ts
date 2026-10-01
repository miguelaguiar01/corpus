import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
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

  test("an entity is not letters: a text of only entities is no finding", () => {
    const source = `
      export const X = () => (
        <p>
          <span>&nbsp;</span>
          <span>&middot;</span>
          <span>&nbsp;&bull;&nbsp;</span>
          <span>&#8212;</span>
          <span>&#x2014;</span>
          <span>&frobnicate;</span>
          <b>&nbsp;Save now</b>
        </p>
      );`;
    expect(findLiterals(source, "x.tsx").map((f) => f.text)).toEqual([
      "&frobnicate;",
      "&nbsp;Save now",
    ]);
    // A quoted attribute is markup too; a string in braces is not, since
    // React renders it as written.
    expect(
      findLiterals(
        `export const X = () => <img alt="&nbsp;&middot;" />;`,
        "x.tsx",
      ),
    ).toEqual([]);
    expect(
      findLiterals(
        `export const X = () => <p>{"&nbsp;&middot;"}</p>;`,
        "x.tsx",
      ).map((f) => f.text),
    ).toEqual(["&nbsp;&middot;"]);
    // Uppercase hex decodes; an out-of-range reference is left as
    // written and does not throw.
    expect(
      findLiterals(`export const X = () => <p>&#X2014;&#8212;</p>;`, "x.tsx"),
    ).toEqual([]);
    expect(
      findLiterals(
        `export const X = () => <p>&#1114112; Save now</p>;`,
        "x.tsx",
      ).map((f) => f.text),
    ).toEqual(["&#1114112; Save now"]);
    // A lone ampersand is text, and does not disturb the decoding.
    expect(
      findLiterals(`export const X = () => <p>a & b</p>;`, "x.tsx").map(
        (f) => f.text,
      ),
    ).toEqual(["a & b"]);
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
    expect(scanned).toEqual([{ dir: "src", parsed: 1 }]);
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
      /check scanned nothing: no directory among src; set check\.include in corpus\.config\.mjs /,
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

test("checkFiles counts the files it parsed, so a clean bill can be honest", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "corpus-check-"));
  try {
    mkdirSync(path.join(dir, "src", "components"), { recursive: true });
    writeFileSync(
      path.join(dir, "src", "components", "a.hbs"),
      `<p>Stray text</p>\n`,
    );
    writeFileSync(
      path.join(dir, "src", "components", "b.ts"),
      `export const b = "not jsx";\n`,
    );
    expect(checkFiles(dir, { include: ["src"] })).toMatchObject({
      findings: [],
      scanned: [{ dir: "src", parsed: 0 }],
    });
    writeFileSync(
      path.join(dir, "src", "components", "c.tsx"),
      `export const C = () => <p>Real finding</p>;\n`,
    );
    const second = checkFiles(dir, { include: ["src"] });
    expect(second.scanned).toEqual([{ dir: "src", parsed: 1 }]);
    expect(second.findings.map((f) => f.text)).toEqual(["Real finding"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check refuses a clean bill when it parsed nothing, and counts the files when it did", async () => {
  const { run } = await import("./cli");
  const dir = mkdtempSync(path.join(os.tmpdir(), "corpus-check-"));
  const ctx = () => {
    const out: string[] = [];
    const err: string[] = [];
    return {
      out,
      err,
      c: {
        cwd: dir,
        env: {},
        out: (l: string) => out.push(l),
        err: (l: string) => err.push(l),
      },
    };
  };
  try {
    mkdirSync(path.join(dir, "i18n"));
    mkdirSync(path.join(dir, "src"));
    writeFileSync(path.join(dir, "i18n", "en.json"), "{}\n");
    writeFileSync(
      path.join(dir, "corpus.config.mjs"),
      `export default { project: "p", server: "http://localhost:3000", sourceLanguage: "en", languages: ["en"], sources: [{ adapter: "messages", type: "chrome", path: "i18n/{lang}.json" }] };\n`,
    );
    writeFileSync(path.join(dir, "src", "a.hbs"), `<p>Stray text</p>\n`);
    const unread = ctx();
    expect(await run(["check"], unread.c)).toBe(1);
    expect(unread.out).toEqual([]);
    expect(unread.err.join("\n")).toMatch(
      /corpus: check parsed no files in src; it reads \.jsx, \.tsx, \.vue and \.svelte/,
    );

    // A second include that does parse must not buy a clean bill for the
    // first: the unread directory is still named, on a passing run. Its
    // own project, since a config is loaded once per process.
    const two = mkdtempSync(path.join(os.tmpdir(), "corpus-check-"));
    try {
      mkdirSync(path.join(two, "i18n"));
      mkdirSync(path.join(two, "app"));
      mkdirSync(path.join(two, "src"));
      writeFileSync(path.join(two, "i18n", "en.json"), "{}\n");
      writeFileSync(path.join(two, "src", "a.hbs"), `<p>Stray text</p>\n`);
      writeFileSync(
        path.join(two, "app", "ok.tsx"),
        `export const O = () => <p>{x}</p>;\n`,
      );
      writeFileSync(
        path.join(two, "corpus.config.mjs"),
        `export default { project: "p", server: "http://localhost:3000", sourceLanguage: "en", languages: ["en"], sources: [{ adapter: "messages", type: "chrome", path: "i18n/{lang}.json" }], check: { include: ["app", "src"] } };\n`,
      );
      const out: string[] = [];
      const err: string[] = [];
      const code = await run(["check"], {
        cwd: two,
        env: {},
        out: (l: string) => out.push(l),
        err: (l: string) => err.push(l),
      });
      expect(code).toBe(0);
      expect(err.join("\n")).toMatch(/parsed no files in src/);
      expect(out.join("\n")).toMatch(/in 1 file\(s\)/);
    } finally {
      rmSync(two, { recursive: true, force: true });
    }

    writeFileSync(
      path.join(dir, "src", "b.tsx"),
      `export const B = () => <p>{x}</p>;\n`,
    );
    const mixed = ctx();
    expect(await run(["check"], mixed.c)).toBe(0);
    expect(mixed.err.join("\n")).not.toMatch(/parsed no files/);
    expect(mixed.out.join("\n")).toMatch(
      /no user-facing literals outside declared sources in 1 file\(s\)/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an include entry that is not there is named, even when another was scanned", () => {
  // #499: a renamed directory narrowed the lint and the run stayed
  // green, because a sibling entry had been scanned.
  const dir = mkdtempSync(path.join(os.tmpdir(), "corpus-include-"));
  mkdirSync(path.join(dir, "src"), { recursive: true });
  writeFileSync(
    path.join(dir, "src", "A.tsx"),
    "export const A = () => <p>Hello</p>;\n",
  );
  writeFileSync(path.join(dir, "notes.txt"), "not a directory\n");

  const result = checkFiles(dir, {
    include: ["src", "gone", "notes.txt"],
    allow: [],
  });
  expect(result.scanned.map((s) => s.dir)).toEqual(["src"]);
  expect(result.unscanned).toEqual([
    { dir: "gone", reason: "missing" },
    { dir: "notes.txt", reason: "not-a-directory" },
  ]);
  expect(result.findings).toHaveLength(1);
  rmSync(dir, { recursive: true, force: true });
});

test("an entry it cannot read is named and skipped, and the rest is still scanned", () => {
  // A dangling symlink under an included directory threw out of the
  // walk: before #499 that was caught by a try around the whole entry,
  // which lost the directory's scan record and produced a "scanned
  // nothing" error for a tree that was plainly there.
  const dir = mkdtempSync(path.join(os.tmpdir(), "corpus-unreadable-"));
  mkdirSync(path.join(dir, "src"), { recursive: true });
  writeFileSync(
    path.join(dir, "src", "A.tsx"),
    "export const A = () => <p>Hi</p>;\n",
  );
  symlinkSync("/nowhere/at/all", path.join(dir, "src", "dangling"));

  const result = checkFiles(dir, { include: ["src"], allow: [] });
  expect(result.findings).toHaveLength(1);
  expect(result.scanned).toEqual([{ dir: "src", parsed: 1 }]);
  expect(result.unscanned).toEqual([
    { dir: "src/dangling", reason: "unreadable" },
  ]);
  rmSync(dir, { recursive: true, force: true });
});

test("test, spec and story files are skipped and counted; a __tests__ directory named in include is read (#656)", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "corpus-check-"));
  try {
    mkdirSync(path.join(dir, "src", "__tests__"), { recursive: true });
    const jsx = (text: string) => `export const C = () => <p>${text}</p>;\n`;
    writeFileSync(path.join(dir, "src", "App.tsx"), jsx("Real finding"));
    writeFileSync(path.join(dir, "src", "App.test.tsx"), jsx("Fixture"));
    writeFileSync(path.join(dir, "src", "App.spec.jsx"), jsx("Fixture"));
    writeFileSync(path.join(dir, "src", "App.stories.tsx"), jsx("Story"));
    writeFileSync(path.join(dir, "src", "__tests__", "a.tsx"), jsx("Fixture"));
    const result = checkFiles(dir, { include: ["src"] });
    expect(result.findings.map((f) => f.text)).toEqual(["Real finding"]);
    expect(result.scanned).toEqual([{ dir: "src", parsed: 1, tests: 4 }]);
    const named = checkFiles(dir, { include: ["src/__tests__"] });
    expect(named.findings.map((f) => f.text)).toEqual(["Fixture"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a text over several lines is reported at the line it starts on (#656)", () => {
  const source = [
    "export const C = () => (",
    "  <p>",
    "    Paste your Mermaid",
    "    definition here",
    "  </p>",
    ");",
  ].join("\n");
  expect(findLiterals(source, "c.tsx")).toEqual([
    { file: "c.tsx", line: 3, text: "Paste your Mermaid\n    definition here" },
  ]);
  // Excalidraw's TTDDialogOutput.tsx: a text shorter than its indent.
  const short = [
    "export const C = () => (",
    "                <div>",
    "                  Likely causes:",
    "                </div>",
    ");",
  ].join("\n");
  expect(findLiterals(short, "c.tsx")).toEqual([
    { file: "c.tsx", line: 3, text: "Likely causes:" },
  ]);
});

test("check says how many test files it skipped (#656)", async () => {
  const { run } = await import("./cli");
  const dir = mkdtempSync(path.join(os.tmpdir(), "corpus-check-"));
  try {
    mkdirSync(path.join(dir, "i18n"));
    mkdirSync(path.join(dir, "src"));
    writeFileSync(path.join(dir, "i18n", "en.json"), "{}\n");
    writeFileSync(
      path.join(dir, "corpus.config.mjs"),
      `export default { project: "p", server: "http://localhost:3000", sourceLanguage: "en", languages: ["en"], sources: [{ adapter: "messages", type: "ui", path: "i18n/{lang}.json" }] };\n`,
    );
    writeFileSync(
      path.join(dir, "src", "A.tsx"),
      "export const A = () => null;\n",
    );
    writeFileSync(
      path.join(dir, "src", "A.test.tsx"),
      "export const T = () => <p>Fixture</p>;\n",
    );
    const out: string[] = [];
    const err: string[] = [];
    const code = await run(["check"], {
      cwd: dir,
      env: {},
      out: (l) => out.push(l),
      err: (l) => err.push(l),
    });
    expect(code).toBe(0);
    expect(err.join("\n")).toMatch(/check skipped 1 test, spec or story file/);

    // A directory of nothing but tests says so, and why: a directory of
    // its own, as a rewritten config at the same path is cached.
    const only = mkdtempSync(path.join(os.tmpdir(), "corpus-check-"));
    try {
      mkdirSync(path.join(only, "i18n"));
      mkdirSync(path.join(only, "e2e"));
      writeFileSync(path.join(only, "i18n", "en.json"), "{}\n");
      writeFileSync(
        path.join(only, "e2e", "App.spec.tsx"),
        "export const T = () => <p>Fixture</p>;\n",
      );
      writeFileSync(
        path.join(only, "corpus.config.mjs"),
        `export default { project: "p", server: "http://localhost:3000", sourceLanguage: "en", languages: ["en"], sources: [{ adapter: "messages", type: "ui", path: "i18n/{lang}.json" }], check: { include: ["e2e"] } };\n`,
      );
      const err2: string[] = [];
      expect(
        await run(["check"], {
          cwd: only,
          env: {},
          out: () => {},
          err: (l) => err2.push(l),
        }),
      ).toBe(1);
      expect(err2.join("\n")).toMatch(/check skipped 1 test/);
      expect(err2.join("\n")).toMatch(
        /parsed no files in e2e: every file there is a test, spec or story/,
      );
    } finally {
      rmSync(only, { recursive: true, force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("in JSX a text that is wholly a URL is no finding, a label always text (#1019)", () => {
  const source = `export const A = () => (
  <>
    <input placeholder="https://example.com/webhook" />
    <input placeholder={"wss://127.0.0.1:7777/"} />
    <input placeholder="See https://example.com" />
    <input placeholder="https://" />
    <a>https://example.com/docs</a>
    <TextField label="username" />
    <option label="name">x</option>
  </>
);`;
  // In JSX a label is a caption, a React library's TextField's as much
  // as a native element's: only the URL rule applies.
  expect(findLiterals(source, "a.tsx").map((f) => f.text)).toEqual([
    "See https://example.com",
    "username",
    "name",
  ]);
});
