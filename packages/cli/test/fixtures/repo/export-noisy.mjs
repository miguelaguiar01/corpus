// An exporter that says what it skipped on stderr, as Joplin's does.
process.stderr.write("fuzzy: 3, skipped: 1\n");
console.log(
  JSON.stringify({
    strings: [{ id: "exec.noisy", type: "computed", source: "Noisy." }],
  }),
);
