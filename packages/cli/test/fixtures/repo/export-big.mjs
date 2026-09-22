// An exporter past spawnSync's default 1 MiB: 4 MB of seeds (#554).
const strings = [{ id: "big.one", type: "computed", source: "One." }];
const translations = { "pt-PT": {} };
for (let i = 0; i < 40000; i++)
  translations["pt-PT"][`big.seed.${i}`] = "x".repeat(90);
process.stdout.write(JSON.stringify({ strings, translations }));
