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

  test("the flat key lands at the root, however deep the literal sits, on the empty-file path and the splice path alike", () => {
    const template = `{\n  "a": {\n    "b": "x"\n  }\n}\n`;
    const texts = { "a.b": "y", "a.b.c": "z" };
    const expected = { a: { b: "y" }, "a.b.c": "z" };
    const fromEmpty = entriesToMessages(template, texts, "");
    expect(JSON.parse(fromEmpty)).toEqual(expected);
    expect(JSON.parse(entriesToMessages(template, texts))).toEqual(expected);
    // The id reads back as itself, not as a.a.b.c.
    expect(
      messagesToEntries(JSON.parse(fromEmpty), { type: "t" }).map((e) => e.id),
    ).toEqual(["a.b", "a.b.c"]);
    // An object already under the flat name is a collision, not overwritten.
    expect(() =>
      entriesToMessages(
        `{"a": "x", "a.b": {"c": "w"}}`,
        { a: "x", "a.b.c": "w", "a.b": "y" },
        "",
      ),
    ).toThrow(/"a.b" collides/);
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

describe("edits that must not duplicate, and line endings", () => {
  test("a flat-key fallback sets the key it made rather than adding a second", () => {
    const file = `{\n  "ui": "Interface"\n}\n`;
    const once = applyMessagesOps(file, [
      { kind: "add", id: "ui.back", text: "Voltar" },
    ]);
    const twice = applyMessagesOps(once, [
      { kind: "edit", id: "ui.back", text: "Recuar" },
    ]);
    expect(twice).toBe(`{\n  "ui": "Interface",\n  "ui.back": "Recuar"\n}\n`);
    expect(
      entriesToMessages(file, { ui: "Interface", "ui.back": "Voltar" }, once),
    ).toBe(once);
  });

  test("a value that is not a string at the path is replaced, not doubled", () => {
    expect(
      applyMessagesOps('{ "n": 1 }\n', [
        { kind: "edit", id: "n", text: "one" },
      ]),
    ).toBe('{ "n": "one" }\n');
  });

  test("a CRLF file keeps CRLF on an add", () => {
    const file = '{\r\n  "a": "x"\r\n}\r\n';
    expect(applyMessagesOps(file, [{ kind: "add", id: "b", text: "y" }])).toBe(
      '{\r\n  "a": "x",\r\n  "b": "y"\r\n}\r\n',
    );
    expect(
      applyMessagesOps(file, [{ kind: "add", id: "c.d", text: "z" }]),
    ).toBe('{\r\n  "a": "x",\r\n  "c.d": "z"\r\n}\r\n');
  });

  test("an empty object with whitespace inside takes the entry in place of it", () => {
    expect(
      applyMessagesOps("{ }\n", [{ kind: "add", id: "a", text: "x" }]),
    ).toBe('{ "a": "x" }\n');
    expect(
      applyMessagesOps("{\n}\n", [{ kind: "add", id: "a", text: "x" }]),
    ).toBe('{\n  "a": "x"\n}\n');
  });

  test("deleting a middle key takes the comma before it, so a neighbour on its line stays put", () => {
    expect(
      applyMessagesOps('{ "a": "1", "b": "2", "c": "3" }\n', [
        { kind: "delete", id: "b" },
      ]),
    ).toBe('{ "a": "1", "c": "3" }\n');
    expect(
      applyMessagesOps('{\n  "a": "1",\n  "b": "2",\n  "c": "3"\n}\n', [
        { kind: "delete", id: "b" },
      ]),
    ).toBe('{\n  "a": "1",\n  "c": "3"\n}\n');
    expect(
      applyMessagesOps('{\n  "a": "1",\n  "b": "2"\n}\n', [
        { kind: "delete", id: "a" },
      ]),
    ).toBe('{\n  "b": "2"\n}\n');
  });
});

test("a flat catalogue whose keys are sentences, dots and all, reads and writes as flat keys", () => {
  const file = `{\n  "Copy": "Copiar",\n  "Deleting it is permanent. Continue?": "Apagar é definitivo. Continuar?"\n}\n`;
  const entries = messagesToEntries(JSON.parse(file), { type: "ui" });
  expect(entries.map((e) => e.id)).toEqual([
    "Copy",
    "Deleting it is permanent. Continue?",
  ]);
  const texts = Object.fromEntries(entries.map((e) => [e.id, e.source]));
  expect(entriesToMessages(file, texts)).toBe(file);
  expect(entriesToMessages(file, texts, "")).toBe(file);
});

test("a pull into an .arb leaves its @ entries where they are (#558)", () => {
  const existing = `{
  "@@locale": "pt-PT",
  "wallpaper": "Fundo",
  "@wallpaper": {
    "description": "Menu entry",
    "placeholders": {}
  },
  "photosCount": "{count, plural, one {# foto} other {# fotos}}"
}
`;
  const template = `{
  "@@locale": "en",
  "wallpaper": "Wallpaper",
  "@wallpaper": {
    "description": "Menu entry",
    "placeholders": {}
  },
  "photosCount": "{count, plural, one {# photo} other {# photos}}"
}
`;
  const next = entriesToMessages(
    template,
    { wallpaper: "Fundo de ecrã" },
    existing,
  );
  expect(next).toBe(existing.replace('"Fundo"', '"Fundo de ecrã"'));
  expect(entriesToMessages(template, { wallpaper: "Fundo" }, existing)).toBe(
    existing,
  );
});
