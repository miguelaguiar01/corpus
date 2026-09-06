// Assembles the publishable workbench from apps/web's standalone build:
// the traced app (server.js, .next/server and its manifests, the
// migrations) plus the static assets, and nothing from node_modules,
// which npm never packs anyway. The runtime packages the trace pulled
// in are this package's dependencies instead (deps.test.ts keeps the
// two in step). CORPUS_WORKBENCH_SKIP_WEB_BUILD=1 reuses a build.
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const web = path.join(repo, "apps/web");
const standalone = path.join(web, ".next/standalone/apps/web");
const dist = path.join(here, "dist");

if (!process.env.CORPUS_WORKBENCH_SKIP_WEB_BUILD) {
  execFileSync("npm", ["run", "build", "-w", "apps/web"], {
    cwd: repo,
    stdio: "inherit",
  });
}
if (!existsSync(path.join(standalone, "server.js"))) {
  throw new Error(`no standalone build at ${standalone}`);
}

rmSync(dist, { recursive: true, force: true });
const app = path.join(dist, "apps/web");
mkdirSync(path.join(app, ".next"), { recursive: true });

// Everything the trace put beside server.js except its node_modules.
cpSync(standalone, app, {
  recursive: true,
  filter: (src) => !src.split(path.sep).includes("node_modules"),
});
cpSync(path.join(web, ".next/static"), path.join(app, ".next/static"), {
  recursive: true,
});

// Next's bundler gives each external package (better-sqlite3, the one
// native module) a hashed copy under .next/node_modules and requires it
// by that name. npm never packs node_modules, and the package declares
// the real dependency, so the server chunks are rewritten to require
// the real name; the trace files (.nft.json) are Next's own bookkeeping
// and stay as they are.
const hashed = path.join(standalone, ".next/node_modules");
for (const name of existsSync(hashed) ? readdirSync(hashed) : []) {
  const real = name.replace(/-[0-9a-f]{16}$/, "");
  if (real === name) throw new Error(`unexpected traced module ${name}`);
  let rewritten = 0;
  for (const file of walk(path.join(app, ".next/server"))) {
    if (!file.endsWith(".js")) continue;
    const before = readFileSync(file, "utf8");
    if (!before.includes(name)) continue;
    writeFileSync(file, before.split(name).join(real));
    rewritten += 1;
  }
  if (rewritten === 0) {
    throw new Error(
      `no server chunk requires ${name}; the trace changed shape`,
    );
  }
  console.log(`workbench: ${name} -> ${real} in ${rewritten} chunk(s)`);
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

for (const required of [
  "server.js",
  ".next/BUILD_ID",
  ".next/server",
  ".next/static",
  "drizzle",
]) {
  if (!existsSync(path.join(app, required))) {
    throw new Error(`the assembled workbench lacks ${required}`);
  }
}

function bytes(dir) {
  let total = 0;
  for (const file of walk(dir)) total += statSync(file).size;
  return total;
}
console.log(
  `workbench: assembled ${(bytes(dist) / 1024 / 1024).toFixed(1)} MB in ${path.relative(repo, dist)}`,
);
