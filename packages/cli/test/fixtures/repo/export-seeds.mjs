// An exporter that also says what the repository already holds for its
// strings (§3, §8): one real seed, one for an id it did not emit, one empty.
console.log(
  JSON.stringify({
    strings: [
      { id: "exec.greeting", type: "computed", source: "Welcome, {who}." },
      { id: "exec.farewell", type: "computed", source: "Goodbye." },
    ],
    translations: {
      "pt-PT": {
        "exec.greeting": "Bem-vindo, {who}.",
        "exec.gone": "Adeus.",
        "exec.farewell": "",
      },
    },
  }),
);
