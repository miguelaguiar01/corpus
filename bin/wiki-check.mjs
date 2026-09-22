// The comparison bin/wiki-check runs. Kept in JavaScript so the gate
// needs no build step before it can check the wiki.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const wiki = path.join(root, "docs", "wiki");
const block = /<!-- from: (\S+) -->\n```([a-z]*)\n([\s\S]*?)```/g;
const shows = (file, lang, text) =>
  `<!-- from: ${file} -->\n\`\`\`${lang}\n${text}\`\`\``;

// What a block's fence must say for the file it shows, so a TypeScript
// example cannot sit under a shell fence.
const FENCE = {
  ts: "ts",
  json: "json",
  yml: "yaml",
  yaml: "yaml",
  out: "text",
};

const pages = readdirSync(wiki).filter((name) => name.endsWith(".md"));
// Two kinds of file a page may show: examples someone wrote, which are
// formatted and validated like any source, and recordings of what the
// CLI printed, which must stay byte for byte what it printed.
const shownFiles = (dir) => {
  // A kind with nothing in it yet is a directory git does not carry.
  try {
    return readdirSync(path.join(wiki, dir)).map((name) => `${dir}/${name}`);
  } catch {
    return [];
  }
};
const examples = [...shownFiles("examples"), ...shownFiles("recorded")];
const fixing = process.argv.includes("--fix");

const problems = [];
const shown = new Set();
const prose = [];

for (const page of pages) {
  const file = path.join(wiki, page);
  const text = readFileSync(file, "utf8");
  if (text.includes("\r\n")) {
    problems.push(`${page} has CRLF line endings; the pages are LF`);
    continue;
  }
  let found = 0;
  const rewritten = text.replace(block, (whole, from, lang, body) => {
    found += 1;
    shown.add(from);
    let onDisk;
    try {
      onDisk = readFileSync(path.join(wiki, from), "utf8");
    } catch {
      problems.push(`${page} names ${from}, which does not exist`);
      return whole;
    }
    if (!onDisk.endsWith("\n")) {
      problems.push(
        `${from} does not end with a newline, so no block can show it`,
      );
      return whole;
    }
    const wants = FENCE[from.split(".").pop() ?? ""];
    if (wants !== undefined && lang !== wants) {
      problems.push(
        `${page} shows ${from} under a \`${lang}\` fence; it is ${wants}`,
      );
      if (!fixing) return whole;
      return shows(from, wants, onDisk);
    }
    if (body === onDisk) return whole;
    if (fixing) return shows(from, lang, onDisk);
    problems.push(
      `${page} shows ${from} as it is not; run bin/wiki-check --fix`,
    );
    return whole;
  });
  if (fixing && rewritten !== text) {
    writeFileSync(file, rewritten);
    console.log(`wiki-check: rewrote ${page} from its files`);
  }
  if (found === 0 && page !== "_Sidebar.md") prose.push(page);
}

for (const example of examples) {
  if (!shown.has(example)) problems.push(`${example} is never shown on a page`);
}

const sidebar = pages.includes("_Sidebar.md")
  ? readFileSync(path.join(wiki, "_Sidebar.md"), "utf8")
  : undefined;
if (sidebar === undefined) {
  problems.push("docs/wiki/_Sidebar.md is missing");
} else {
  for (const page of pages) {
    if (page === "_Sidebar.md" || page === "Home.md") continue;
    const link = `(${page.replace(/\.md$/, "")})`;
    if (!sidebar.includes(link)) problems.push(`${page} is not in the sidebar`);
  }
}

// The sidebar is written ahead of the pages while the wiki is being
// built, so a link with no page yet is progress, not a problem.
const planned =
  sidebar === undefined
    ? []
    : [...sidebar.matchAll(/\]\(([A-Za-z0-9-]+)\)/g)]
        .map((m) => m[1])
        .filter((name) => !pages.includes(`${name}.md`));

// --fix rewrites the blocks; what it cannot fix it still reports, since
// the failure message sends the reader here.
const fixable = /shows .* as it is not|under a `/;
const left = problems.filter((problem) => !fixing || !fixable.test(problem));
for (const problem of left) console.error(`wiki-check: ${problem}`);
if (left.length > 0) process.exit(1);
if (fixing) process.exit(0);
console.log(
  `wiki-check: ${pages.length} page(s), ${shown.size} checked block(s), prose only: ${
    prose.length > 0 ? prose.join(", ") : "none"
  }`,
);
if (planned.length > 0) {
  console.log(`wiki-check: the sidebar promises ${planned.join(", ")}`);
}
