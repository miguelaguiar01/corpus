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
    const findings = checkFiles(dir, {
      include: ["src"],
      ignore: ["src/generated"],
    });
    expect(findings.map((f) => `${f.file}:${f.line}: ${f.text}`)).toEqual([
      "src/components/a.tsx:1: Hello there",
    ]);
  });
});
