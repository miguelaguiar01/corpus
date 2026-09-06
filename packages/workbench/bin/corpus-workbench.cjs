#!/usr/bin/env node
// Starts the workbench (§2). `corpus workbench` sets the environment
// from .corpus/ and calls this; a host sets it by hand. server.js is
// Next's standalone entry: it reads PORT and HOSTNAME and changes into
// its own directory, so the migrations resolve beside it.
const path = require("node:path");

const missing = ["CORPUS_DB_PATH", "CORPUS_INVITE_SECRET"].filter(
  (name) => !process.env[name],
);
if (missing.length > 0) {
  process.stderr.write(
    `corpus-workbench: set ${missing.join(" and ")} (the database file and the instance invite secret)\n`,
  );
  process.exit(1);
}
process.env.CORPUS_DB_PATH = path.resolve(process.env.CORPUS_DB_PATH);
process.env.PORT ??= "3000";
process.env.HOSTNAME ??= "127.0.0.1";
process.env.NODE_ENV = "production";
process.env.CORPUS_VERSION ??= `v${require("../package.json").version}`;

require("../dist/apps/web/server.js");
