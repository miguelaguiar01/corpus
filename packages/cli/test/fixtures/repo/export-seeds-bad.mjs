// An exporter naming the source language and one the config lacks.
console.log(
  JSON.stringify({
    strings: [{ id: "exec.greeting", type: "computed", source: "Welcome." }],
    translations: {
      en: { "exec.greeting": "Welcome." },
      fr: { "exec.greeting": "Bienvenue." },
    },
  }),
);
