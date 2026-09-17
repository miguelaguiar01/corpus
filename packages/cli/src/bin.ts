#!/usr/bin/env node
import { run } from "./cli";

run(process.argv.slice(2), {
  cwd: process.cwd(),
  env: process.env,
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
}).then((code) => {
  // A pipe takes stdout asynchronously: exit only once every queued
  // byte is out, or a long answer loses its tail.
  process.stderr.write("", () =>
    process.stdout.write("", () => process.exit(code)),
  );
});
