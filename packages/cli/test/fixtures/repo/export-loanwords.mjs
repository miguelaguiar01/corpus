// An exporter that marks a translation identical to its source as done
// (#658): a loanword, `Status` in German.
console.log(
  JSON.stringify({
    strings: [
      { id: "exec.status", type: "computed", source: "Status" },
      { id: "exec.name", type: "computed", source: "Name" },
    ],
    translations: {
      de: {
        "exec.status": { text: "Status", state: "translated" },
        "exec.name": "Name",
      },
    },
  }),
);
