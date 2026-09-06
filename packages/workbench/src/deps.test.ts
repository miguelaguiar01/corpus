import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.resolve(here, "..");
const repo = path.resolve(here, "../../..");
const traced = path.join(repo, "apps/web/.next/standalone/node_modules");
const manifest = JSON.parse(
  readFileSync(path.join(pkg, "package.json"), "utf8"),
) as { version: string; dependencies: Record<string, string> };

// Every top-level package Next's trace put beside the app must be
// reachable from this package's declared dependencies, since the
// published package ships no node_modules (build.mjs). The walk uses the
// lockfile's graph rather than the top of node_modules: an optional
// platform package can be installed nested, and the runner's platform
// decides which ones are present.
type LockEntry = {
  name?: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

function lockGraph(): Map<string, Set<string>> {
  const lock = JSON.parse(
    readFileSync(path.join(repo, "package-lock.json"), "utf8"),
  ) as { packages: Record<string, LockEntry> };
  const graph = new Map<string, Set<string>>();
  for (const [location, entry] of Object.entries(lock.packages)) {
    const at = location.lastIndexOf("node_modules/");
    if (at < 0) continue;
    const name = entry.name ?? location.slice(at + "node_modules/".length);
    const edges = graph.get(name) ?? new Set<string>();
    for (const dep of Object.keys({
      ...entry.dependencies,
      ...entry.optionalDependencies,
      ...entry.peerDependencies,
    })) {
      edges.add(dep);
    }
    graph.set(name, edges);
  }
  return graph;
}

function reachable(from: string[]): Set<string> {
  const graph = lockGraph();
  const seen = new Set<string>();
  const queue = [...from];
  while (queue.length) {
    const name = queue.shift()!;
    if (seen.has(name)) continue;
    seen.add(name);
    for (const dep of graph.get(name) ?? []) queue.push(dep);
  }
  return seen;
}

function tracedPackages(): string[] {
  const names: string[] = [];
  for (const entry of readdirSync(traced)) {
    if (entry.startsWith("@")) {
      for (const scoped of readdirSync(path.join(traced, entry))) {
        names.push(`${entry}/${scoped}`);
      }
    } else {
      names.push(entry);
    }
  }
  return names;
}

test.skipIf(!existsSync(traced))(
  "the declared dependencies cover every package the standalone trace pulled in",
  () => {
    const covered = reachable(Object.keys(manifest.dependencies));
    const uncovered = tracedPackages().filter((name) => !covered.has(name));
    expect(uncovered).toEqual([]);
  },
);

test("the workbench carries the CLI's version", () => {
  const cli = JSON.parse(
    readFileSync(path.join(repo, "packages/cli/package.json"), "utf8"),
  ) as { version: string };
  expect(manifest.version).toBe(cli.version);
});
