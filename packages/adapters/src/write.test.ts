import { describe, expect, test } from "vitest";
import { messagesToEntries, tableToEntries } from "./index";
import {
  entriesToMessages,
  entriesToTable,
  applyMessagesOps,
  applyTableOps,
} from "./write";

const FLAT = `{
  "app.title": "Corpus",
  "nav.overview": "Overview",
  "nav.catalogue": "Catalogue"
}
`;

const NESTED = `{
    "skin": {
        "seen": "{person} foi visto.",
        "heard": "Não ouvi nada."
    },
    "ui": {
        "continue": "Continuar"
    }
}`;

function textsOf(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of messagesToEntries(JSON.parse(file), { type: "t" }))
    out[e.id] = e.source;
  return out;
}

describe("entriesToMessages", () => {
  test("read → write with the same texts is byte-identical (flat, 2 spaces, trailing newline)", () => {
    expect(entriesToMessages(FLAT, textsOf(FLAT))).toBe(FLAT);
  });

  test("read → write is byte-identical for a nested, 4-space file with no trailing newline", () => {
    expect(entriesToMessages(NESTED, textsOf(NESTED))).toBe(NESTED);
  });

  test("a changed translation lands in the right key, order untouched", () => {
    const out = entriesToMessages(FLAT, {
      ...textsOf(FLAT),
      "nav.overview": "Visão geral",
    });
    expect(out).toBe(FLAT.replace('"Overview"', '"Visão geral"'));
  });

  test("a nested id lands in its nested position", () => {
    const out = entriesToMessages(NESTED, {
      ...textsOf(NESTED),
      "ui.continue": "Continue",
    });
    expect(JSON.parse(out)).toEqual({
      skin: { seen: "{person} foi visto.", heard: "Não ouvi nada." },
      ui: { continue: "Continue" },
    });
    expect(out.startsWith('{\n    "skin"')).toBe(true);
  });

  test("with the template only, ids absent from the translations are omitted", () => {
    const out = entriesToMessages(FLAT, { "app.title": "Corpus" });
    expect(JSON.parse(out)).toEqual({ "app.title": "Corpus" });
  });

  test("with an existing target file, ids absent from the translations keep the existing value", () => {
    const existing = `{
  "app.title": "Corpus",
  "nav.overview": "Visão geral"
}
`;
    const out = entriesToMessages(
      FLAT,
      { "nav.catalogue": "Catálogo" },
      existing,
    );
    expect(JSON.parse(out)).toEqual({
      "app.title": "Corpus",
      "nav.overview": "Visão geral",
      "nav.catalogue": "Catálogo",
    });
  });

  test("new ids append in the given order, following the file's flat or nested convention", () => {
    const flat = entriesToMessages(FLAT, {
      ...textsOf(FLAT),
      "nav.settings": "Settings",
    });
    expect(Object.keys(JSON.parse(flat))).toEqual([
      "app.title",
      "nav.overview",
      "nav.catalogue",
      "nav.settings",
    ]);
    const nested = entriesToMessages(NESTED, {
      ...textsOf(NESTED),
      "ui.back": "Voltar",
    });
    expect(JSON.parse(nested).ui).toEqual({
      continue: "Continuar",
      back: "Voltar",
    });
  });

  test("a literal where nesting would go falls back to a flat key", () => {
    const out = entriesToMessages(`{\n  "ui": "Interface"\n}\n`, {
      ui: "Interface",
      "ui.back": "Voltar",
    });
    expect(JSON.parse(out)).toEqual({ ui: "Interface", "ui.back": "Voltar" });
  });

  test("an id that names a nested subtree is an error, not a silent overwrite", () => {
    expect(() =>
      entriesToMessages(NESTED, { ...textsOf(NESTED), ui: "Interface" }),
    ).toThrow(/"ui" collides/);
  });

  test("an empty existing file takes the template's style", () => {
    expect(entriesToMessages(NESTED, { "ui.continue": "Continue" }, "")).toBe(
      `{\n    "ui": {\n        "continue": "Continue"\n    }\n}`,
    );
  });

  test("an empty template writes an empty object in the default style", () => {
    expect(entriesToMessages("", { a: "b" })).toBe(`{\n  "a": "b"\n}\n`);
  });
});

const TABLE = `[
  { "id": "step.1", "text": "Abre a porta.", "kind": "hint" },
  { "id": "step.2", "text": "Procura a chave.", "kind": "task" }
]
`;
const MAP = { id: "id", text: "text" };

describe("entriesToTable", () => {
  test("read → write with the same texts is byte-identical", () => {
    const texts: Record<string, string> = {};
    for (const e of tableToEntries(JSON.parse(TABLE), { type: "t", map: MAP }))
      texts[e.id] = e.source;
    expect(entriesToTable(TABLE, texts, MAP)).toBe(TABLE);
  });

  test("a translation replaces the text field and keeps the other fields", () => {
    const out = entriesToTable(
      TABLE,
      { "step.1": "Open the door.", "step.2": "Find the key." },
      MAP,
    );
    expect(JSON.parse(out)).toEqual([
      { id: "step.1", text: "Open the door.", kind: "hint" },
      { id: "step.2", text: "Find the key.", kind: "task" },
    ]);
  });

  test("records without a translation are omitted unless an existing file carries them", () => {
    const partial = entriesToTable(TABLE, { "step.2": "Find the key." }, MAP);
    expect(JSON.parse(partial)).toEqual([
      { id: "step.2", text: "Find the key.", kind: "task" },
    ]);
    const existing = `[
  { "id": "step.1", "text": "Open the door.", "kind": "hint" }
]
`;
    const merged = entriesToTable(
      TABLE,
      { "step.2": "Find the key." },
      MAP,
      existing,
    );
    expect(JSON.parse(merged)).toEqual([
      { id: "step.1", text: "Open the door.", kind: "hint" },
      { id: "step.2", text: "Find the key.", kind: "task" },
    ]);
  });
});

test("an id that would walk into the prototype is refused", () => {
  const nested = '{\n  "a": {\n    "b": "B"\n  }\n}\n';
  expect(() =>
    entriesToMessages(nested, { "__proto__.polluted": "EVIL" }, undefined),
  ).toThrow(/not a valid key path/);
  expect(() =>
    entriesToMessages(nested, { "constructor.prototype.x": "y" }, undefined),
  ).toThrow(/not a valid key path/);
  // A flat catalog has the whole id as one segment; still refused.
  expect(() =>
    entriesToMessages('{\n  "a": "A"\n}\n', { ["__proto__"]: "P" }, undefined),
  ).toThrow(/not a valid key path/);
  expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  expect(
    Object.prototype.hasOwnProperty.call(Object.prototype, "polluted"),
  ).toBe(false);
});

test("messages ops: an edit sets, an add appends nested when the file nests, a delete prunes an emptied branch; format kept", () => {
  const file = `{\n\t"app": {\n\t\t"title": "Corpus",\n\t\t"greeting": "Olá {name}"\n\t},\n\t"nav": {\n\t\t"catalogue": "Catálogo"\n\t}\n}\n`;
  const next = applyMessagesOps(file, [
    { kind: "edit", id: "app.greeting", text: "Viva {name}" },
    { kind: "add", id: "app.back", text: "Voltar" },
    { kind: "delete", id: "nav.catalogue" },
  ]);
  expect(next).toBe(
    `{\n\t"app": {\n\t\t"title": "Corpus",\n\t\t"greeting": "Viva {name}",\n\t\t"back": "Voltar"\n\t}\n}\n`,
  );
  expect(
    applyMessagesOps('{"a": "x"}', [{ kind: "add", id: "b.c", text: "y" }]),
  ).toBe('{"a": "x", "b.c": "y"}');
  // A delete of an absent key is nothing, so a second pull and a
  // target file without the key are fine.
  expect(applyMessagesOps('{"a": "x"}\n', [{ kind: "delete", id: "zz" }])).toBe(
    '{"a": "x"}\n',
  );
});

test("messages ops: a delete that empties a branch prunes it", () => {
  expect(
    applyMessagesOps(
      `{\n  "nav": {\n    "catalogue": "Catálogo"\n  },\n  "app": {\n    "title": "Corpus"\n  }\n}\n`,
      [{ kind: "delete", id: "nav.catalogue" }],
    ),
  ).toBe(`{\n  "app": {\n    "title": "Corpus"\n  }\n}\n`);
});

test("table ops: edit by id, add a minimal record, delete a record; the one-per-line layout kept", () => {
  const file = `[\n  { "id": "s1", "text": "Um", "kind": "hint" },\n  { "id": "s2", "text": "Dois", "kind": "task" }\n]\n`;
  const next = applyTableOps(
    file,
    [
      { kind: "edit", id: "s2", text: "Dois!" },
      { kind: "add", id: "s3", text: "Três" },
      { kind: "delete", id: "s1" },
    ],
    { id: "id", text: "text" },
  );
  expect(next).toBe(
    `[\n  { "id": "s2", "text": "Dois!", "kind": "task" },\n  { "id": "s3", "text": "Três" }\n]\n`,
  );
  expect(
    applyTableOps(file, [{ kind: "delete", id: "nope" }], {
      id: "id",
      text: "text",
    }),
  ).toBe(file);
});

// A catalogue that keeps small objects on one line, as a hand-kept file
// does: every edit must read as the line it changes (§8).
const INLINE = `{
  "home": {
    "subtitle": "uma casa, uma noite",
    "daily": { "title": "O caso de hoje", "dims": "UM CASO NOVO" },
    "archive": { "title": "Arquivo", "dims": "OS CASOS QUE JÁ SAÍRAM" }
  },
  "langToggle": { "toEnAria": "switch to English", "toEn": "EN", "toPt": "PT" },
  "caseClient": { "notFound": "este caso não foi encontrado" }
}
`;

describe("format-preserving edits on an inline-style file", () => {
  test("read → write with the same texts is byte-identical", () => {
    expect(entriesToMessages(INLINE, textsOf(INLINE))).toBe(INLINE);
    expect(entriesToMessages(INLINE, {}, INLINE)).toBe(INLINE);
  });

  test("a changed value touches only its token", () => {
    const out = entriesToMessages(INLINE, {
      ...textsOf(INLINE),
      "home.daily.dims": "UM CASO POR DIA",
    });
    expect(out).toBe(INLINE.replace('"UM CASO NOVO"', '"UM CASO POR DIA"'));
  });

  test("proposals read as the lines they change: an edit, a delete inside an inline object, an add", () => {
    const out = applyMessagesOps(INLINE, [
      { kind: "edit", id: "caseClient.notFound", text: "caso não encontrado" },
      { kind: "delete", id: "langToggle.toEnAria" },
      { kind: "add", id: "home.quickplay", text: "Jogo livre" },
    ]);
    expect(out).toBe(`{
  "home": {
    "subtitle": "uma casa, uma noite",
    "daily": { "title": "O caso de hoje", "dims": "UM CASO NOVO" },
    "archive": { "title": "Arquivo", "dims": "OS CASOS QUE JÁ SAÍRAM" },
    "quickplay": "Jogo livre"
  },
  "langToggle": { "toEn": "EN", "toPt": "PT" },
  "caseClient": { "notFound": "caso não encontrado" }
}
`);
  });

  test("a new nested id under an inline object stays inline; under an expanded one it expands", () => {
    expect(
      applyMessagesOps(INLINE, [
        { kind: "add", id: "langToggle.more.x", text: "y" },
      ]),
    ).toContain(
      `"langToggle": { "toEnAria": "switch to English", "toEn": "EN", "toPt": "PT", "more": { "x": "y" } }`,
    );
    expect(
      applyMessagesOps(INLINE, [
        { kind: "add", id: "home.rules.title", text: "Como se joga" },
      ]),
    )
      .toContain(`    "archive": { "title": "Arquivo", "dims": "OS CASOS QUE JÁ SAÍRAM" },
    "rules": {
      "title": "Como se joga"
    }
  },`);
  });

  test("deleting the only key of an inline object removes the object; of the file leaves {}", () => {
    expect(
      applyMessagesOps(INLINE, [{ kind: "delete", id: "caseClient.notFound" }]),
    ).toBe(
      INLINE.replace(
        `,\n  "caseClient": { "notFound": "este caso não foi encontrado" }`,
        "",
      ),
    );
    expect(
      applyMessagesOps('{ "a": "x" }\n', [{ kind: "delete", id: "a" }]),
    ).toBe("{}\n");
    expect(
      applyMessagesOps("{}\n", [{ kind: "add", id: "a", text: "x" }]),
    ).toBe('{ "a": "x" }\n');
  });

  test("a single-line file stays single-line", () => {
    expect(
      entriesToMessages('{"a":"x","b":"y"}', { a: "x", b: "z", c: "w" }),
    ).toBe('{"a":"x","b":"z", "c": "w"}');
  });
});
