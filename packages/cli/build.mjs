// Builds the publishable package: two ESM bundles (the bin and the library
// entry) with the workspace packages folded in, and declarations for all
// three packages rewritten so the published types never import
// @corpus/contract or @corpus/adapters by name.
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import {
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(root, "dist");
rmSync(dist, { recursive: true, force: true });

const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
await build({
  entryPoints: [path.join(root, "src/bin.ts"), path.join(root, "src/index.ts")],
  outdir: dist,
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "node",
  target: "node22",
  external: Object.keys(pkg.dependencies),
  logLevel: "warning",
});

execFileSync("npx", ["tsc", "-p", "tsconfig.build.json"], {
  cwd: root,
  stdio: "inherit",
});

const WORKSPACE = {
  "@corpus/contract": "contract/src/index",
  "@corpus/adapters": "adapters/src/index",
};
const types = path.join(dist, "types");
for (const file of walk(types)) {
  let text = readFileSync(file, "utf8");
  for (const [name, target] of Object.entries(WORKSPACE)) {
    let rel = path
      .relative(path.dirname(file), path.join(types, target))
      .split(path.sep)
      .join("/");
    if (!rel.startsWith(".")) rel = `./${rel}`;
    text = text.replaceAll(`"${name}"`, `"${rel}"`);
  }
  writeFileSync(file, text);
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (full.endsWith(".d.ts")) yield full;
  }
}
