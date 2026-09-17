#!/usr/bin/env node
import { run } from "./cli";

// A reader that closed early (`| head`) is not an error worth a stack
// trace: stop where it stopped reading.
process.stdout.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});

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
