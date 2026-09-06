process.stdout.write(
  JSON.stringify({
    strings: [{ id: "clue.at", type: "clue", source: "Seen at {room}." }],
    entities: [{ id: "room:hall", type: "room", name: "Hall" }],
  }),
);
