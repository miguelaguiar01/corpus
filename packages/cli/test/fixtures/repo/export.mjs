// A client's custom exporter: emits snapshot entries on stdout (§3).
console.log(
  JSON.stringify({
    strings: [
      {
        id: "exec.greeting",
        type: "computed",
        source: "Bem-vindo, {who}.",
        // A file an exporter should not claim: the build drops it (§4).
        file: "made-up.json",
      },
    ],
    entities: [{ id: "trait:brave", type: "trait", name: "Bravo" }],
  }),
);
