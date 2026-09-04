// A client's custom exporter: emits snapshot entries on stdout (§3).
console.log(
  JSON.stringify({
    strings: [
      { id: "exec.greeting", type: "computed", source: "Bem-vindo, {who}." },
    ],
    entities: [{ id: "trait:brave", type: "trait", name: "Bravo" }],
  }),
);
