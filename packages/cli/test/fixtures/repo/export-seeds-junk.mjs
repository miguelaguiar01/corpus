// translations that are not a map of language to id to text.
console.log(
  JSON.stringify({
    strings: [{ id: "exec.greeting", type: "computed", source: "Welcome." }],
    translations: { "pt-PT": ["Bem-vindo."] },
  }),
);
