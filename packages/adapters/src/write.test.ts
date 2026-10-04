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
    // An empty file's {} takes one key a line (#1041).
    expect(
      applyMessagesOps("{}\n", [{ kind: "add", id: "a", text: "x" }]),
    ).toBe('{\n  "a": "x"\n}\n');
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
    ).toBe('{\n  "a": "x"\n}\n');
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

test("a first pull into a missing .arb writes @@locale first and none of the source's @ metadata (#568)", () => {
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
  const translations = {
    photosCount: "{count, plural, one {# Foto} other {# Fotos}}",
    wallpaper: "Hintergrund",
  };
  expect(entriesToMessages(template, translations, undefined, { locale: "de" }))
    .toBe(`{
  "@@locale": "de",
  "wallpaper": "Hintergrund",
  "photosCount": "{count, plural, one {# Foto} other {# Fotos}}"
}
`);
  // gen-l10n compares @@locale, as written, with the file name's locale
  // normalised to underscores, so a hyphenated code is written with
  // underscores whatever the file name says (#585).
  expect(
    entriesToMessages(template, translations, undefined, { locale: "pt-PT" }),
  ).toBe(`{
  "@@locale": "pt_PT",
  "wallpaper": "Hintergrund",
  "photosCount": "{count, plural, one {# Foto} other {# Fotos}}"
}
`);
  expect(
    entriesToMessages(template, translations, undefined, {
      locale: "zh-Hant-TW",
    }),
  ).toContain('"@@locale": "zh_Hant_TW"');
  // An empty file is a missing one; a .json first pull carries no locale.
  expect(entriesToMessages(template, translations, "", { locale: "de" })).toBe(
    entriesToMessages(template, translations, undefined, { locale: "de" }),
  );
  expect(entriesToMessages(`{\n  "a": "A"\n}\n`, { a: "B" })).toBe(
    `{\n  "a": "B"\n}\n`,
  );
});

describe("a Chrome i18n catalogue (#595)", () => {
  const CHROME = { chrome: true };
  const SOURCE = `\uFEFF{
  "copied": {
    "message": "Copied $CURRENT$",
    "description": "After a copy.",
    "placeholders": {
      "current": {
        "content": "$1",
        "example": "3"
      }
    }
  },
  "save": {
    "message": "Save"
  }
}
`;
  const TARGET = `\uFEFF{
  "copied": {
    "message": "Copiado $CURRENT$",
    "description": "After a copy.",
    "placeholders": {
      "current": {
        "content": "$1",
        "example": "3"
      }
    }
  }
}
`;

  test("an unchanged pull is byte-identical, BOM included; a changed message edits its message alone", () => {
    expect(
      entriesToMessages(
        SOURCE,
        { copied: "Copiado $CURRENT$" },
        TARGET,
        CHROME,
      ),
    ).toBe(TARGET);
    expect(
      entriesToMessages(
        SOURCE,
        { copied: "$CURRENT$ copiados" },
        TARGET,
        CHROME,
      ),
    ).toBe(TARGET.replace("Copiado $CURRENT$", "$CURRENT$ copiados"));
  });

  test("a new key copies the source's description and placeholders, in the file's layout", () => {
    expect(entriesToMessages(SOURCE, { save: "Guardar" }, TARGET, CHROME)).toBe(
      TARGET.replace(
        "\n  }\n}\n",
        '\n  },\n  "save": {\n    "message": "Guardar"\n  }\n}\n',
      ),
    );
    const fresh = `\uFEFF{\n  "save": {\n    "message": "Guardar"\n  }\n}\n`;
    expect(entriesToMessages(SOURCE, { save: "Guardar" }, fresh, CHROME)).toBe(
      fresh,
    );
    const empty = `{\n}\n`;
    const out = entriesToMessages(
      SOURCE,
      { copied: "Copiado $CURRENT$" },
      empty,
      CHROME,
    );
    expect(JSON.parse(out)).toEqual({
      copied: {
        message: "Copiado $CURRENT$",
        description: "After a copy.",
        placeholders: { current: { content: "$1", example: "3" } },
      },
    });
  });

  test("a missing file is the source with its messages translated and the untranslated keys left out, BOM kept", () => {
    expect(
      entriesToMessages(
        SOURCE,
        { copied: "Copiado $CURRENT$" },
        undefined,
        CHROME,
      ),
    ).toBe(TARGET);
  });

  test("a key named like a prototype member is added and written like any other", () => {
    const out = entriesToMessages(
      `{\n  "toString": { "message": "Text" }\n}\n`,
      { toString: "Texto" },
      "{}\n",
      CHROME,
    );
    expect(JSON.parse(out)).toEqual({ toString: { message: "Texto" } });
  });

  test("proposal ops edit, add and remove a whole entry", () => {
    const out = applyMessagesOps(
      SOURCE,
      [
        { kind: "edit", id: "save", text: "Save it" },
        { kind: "add", id: "cancel", text: "Cancel" },
        { kind: "delete", id: "copied" },
      ],
      CHROME,
    );
    expect(out).toBe(
      `\uFEFF{\n  "save": {\n    "message": "Save it"\n  },\n  "cancel": {\n    "message": "Cancel"\n  }\n}\n`,
    );
  });
});

describe("a key segment with a dot in it (#642)", () => {
  const SOURCE = `{
  "timeline": {
    "m.room.topic": {
      "removed": "%(senderDisplayName)s removed the topic.",
      "changed": "%(senderDisplayName)s changed the topic."
    }
  }
}
`;
  const TARGET = `{
  "timeline": {
    "m.room.topic": {
      "changed": "%(senderDisplayName)s a changé le sujet."
    }
  }
}
`;

  test("a new key is written under the segment the source file has, not split on its dots", () => {
    const out = entriesToMessages(
      SOURCE,
      {
        "timeline.m.room.topic.changed":
          "%(senderDisplayName)s a changé le sujet.",
        "timeline.m.room.topic.removed":
          "%(senderDisplayName)s a retiré le sujet.",
      },
      TARGET,
    );
    expect(JSON.parse(out)).toEqual({
      timeline: {
        "m.room.topic": {
          changed: "%(senderDisplayName)s a changé le sujet.",
          removed: "%(senderDisplayName)s a retiré le sujet.",
        },
      },
    });
  });

  test("a first pull into a missing file keeps the source's segments too", () => {
    const out = entriesToMessages(
      SOURCE,
      { "timeline.m.room.topic.removed": "Sujet retiré." },
      "",
    );
    expect(JSON.parse(out)).toEqual({
      timeline: { "m.room.topic": { removed: "Sujet retiré." } },
    });
  });

  test("a proposal edits and removes a key under a dotted segment", () => {
    const out = applyMessagesOps(SOURCE, [
      { kind: "edit", id: "timeline.m.room.topic.changed", text: "Changed." },
      { kind: "delete", id: "timeline.m.room.topic.removed" },
    ]);
    expect(JSON.parse(out)).toEqual({
      timeline: { "m.room.topic": { changed: "Changed." } },
    });
  });
});

describe("a key new to a target file lands in the source file's order (#654)", () => {
  const source = `{
  "app": {
    "title": "Title",
    "save": "Save",
    "cancel": "Cancel"
  },
  "script": {
    "run": "Run",
    "stop": "Stop"
  },
  "zeta": "Z"
}
`;

  test("after its nearest preceding sibling the target has", () => {
    const target = `{
  "app": {
    "title": "Titel",
    "cancel": "Abbrechen"
  },
  "zeta": "Z"
}
`;
    expect(entriesToMessages(source, { "app.save": "Speichern" }, target))
      .toBe(`{
  "app": {
    "title": "Titel",
    "save": "Speichern",
    "cancel": "Abbrechen"
  },
  "zeta": "Z"
}
`);
  });

  test("before its nearest following sibling when none precedes", () => {
    const target = `{
  "app": {
    "save": "Speichern"
  }
}
`;
    expect(entriesToMessages(source, { "app.title": "Titel" }, target)).toBe(`{
  "app": {
    "title": "Titel",
    "save": "Speichern"
  }
}
`);
  });

  test("a whole missing object at its source position, its keys in order", () => {
    const target = `{
  "app": {
    "title": "Titel"
  },
  "zeta": "Z"
}
`;
    expect(
      entriesToMessages(
        source,
        { "script.stop": "Stopp", "script.run": "Ausführen" },
        target,
      ),
    ).toBe(`{
  "app": {
    "title": "Titel"
  },
  "script": {
    "run": "Ausführen",
    "stop": "Stopp"
  },
  "zeta": "Z"
}
`);
  });

  test("in the file's order, integer-like keys included", () => {
    expect(
      entriesToMessages(
        `{ "error": { "title": "Error", "404": "Not found", "500": "Failed" } }`,
        { "error.title": "Fehler" },
        `{ "error": { "404": "Nicht gefunden", "500": "Fehlgeschlagen" } }`,
      ),
    ).toBe(
      `{ "error": { "title": "Fehler", "404": "Nicht gefunden", "500": "Fehlgeschlagen" } }`,
    );
  });

  test("a blank source file gives no order and no error", () => {
    const target = '{\n  "b": "y"\n}\n';
    expect(entriesToMessages("", {}, target)).toBe(target);
    expect(entriesToMessages("  \n", { a: "x" }, target)).toBe(
      '{\n  "b": "y",\n  "a": "x"\n}\n',
    );
  });

  test("on one line, too", () => {
    expect(
      entriesToMessages(
        `{ "a": "A", "b": "B", "c": "C" }`,
        { b: "b" },
        `{ "a": "a", "c": "c" }`,
      ),
    ).toBe(`{ "a": "a", "b": "b", "c": "c" }`);
  });
});

describe("a plural object reads as one plural and writes back as the object (#662)", () => {
  const source = `{
  "rooms": {
    "one": "%(count)s room",
    "other": "%(count)s rooms"
  },
  "title": "Rooms"
}
`;

  test("a target's forms are written in CLDR's order, a form it gains added in place", () => {
    const target = `{
  "rooms": {
    "one": "%(count)s pokój",
    "other": "%(count)s pokoi"
  },
  "title": "Pokoje"
}
`;
    const pl =
      "{count, plural, one {%(count)s pokój} few {%(count)s pokoje} many {%(count)s pokoi} other {%(count)s pokoju}}";
    expect(entriesToMessages(source, { rooms: pl }, target, { plurals: true }))
      .toBe(`{
  "rooms": {
    "one": "%(count)s pokój",
    "few": "%(count)s pokoje",
    "many": "%(count)s pokoi",
    "other": "%(count)s pokoju"
  },
  "title": "Pokoje"
}
`);
  });

  test("what the file holds writes back byte for byte", () => {
    const target = `{
  "rooms": { "one": "a", "other": "b" },
  "title": "T"
}
`;
    const read = messagesToEntries(JSON.parse(target), {
      type: "ui",
      plurals: true,
    });
    const translations = Object.fromEntries(read.map((e) => [e.id, e.source]));
    expect(
      entriesToMessages(source, translations, target, { plurals: true }),
    ).toBe(target);
  });

  test("a new file writes the plural as an object; a plain text is the other form", () => {
    expect(
      JSON.parse(
        entriesToMessages(
          source,
          { rooms: "{count, plural, one {x} other {y}}", title: "T" },
          "",
          { plurals: true },
        ),
      ),
    ).toEqual({ rooms: { one: "x", other: "y" }, title: "T" });
    expect(
      JSON.parse(
        entriesToMessages(source, { rooms: "{count} 个房间" }, "{}\n", {
          plurals: true,
        }),
      ),
    ).toEqual({ rooms: { other: "{count} 个房间" } });
  });
});

describe("a plural the object cannot hold is refused, not flattened into other (#662)", () => {
  const source = `{\n  "rooms": { "one": "{{count}} room", "other": "{{count}} rooms" }\n}\n`;
  test("an =0 branch, or a brace a form leaves open", () => {
    const refused: string[] = [];
    const target = `{\n  "rooms": { "one": "a", "other": "b" }\n}\n`;
    for (const text of [
      "{count, plural, =0 {none} one {one} other {many}}",
      "{count, plural, one {a { b} other {c}}",
    ]) {
      expect(
        entriesToMessages(source, { rooms: text }, target, {
          plurals: true,
          onRefused: (id) => refused.push(id),
        }),
      ).toBe(target);
    }
    expect(refused).toEqual(["rooms", "rooms"]);
  });

  test("an object whose form would not come back through the plural keeps its keys", () => {
    expect(
      messagesToEntries(
        { k: { one: "a } b", other: "c" } },
        { type: "ui", plurals: true },
      ).map((e) => e.id),
    ).toEqual(["k.one", "k.other"]);
  });
});

test("a proposal a plural object cannot hold fails, naming the key (#662)", () => {
  const source = `{\n  "k": { "one": "a", "other": "b" }\n}\n`;
  expect(() =>
    applyMessagesOps(
      source,
      [
        {
          kind: "edit",
          id: "k",
          text: "{count, plural, =0 {none} one {a} other {b}}",
        },
      ],
      { plurals: true },
    ),
  ).toThrow(/k is a plural its object cannot hold/);
  expect(
    applyMessagesOps(
      source,
      [{ kind: "edit", id: "k", text: "{count, plural, one {x} other {y}}" }],
      { plurals: true },
    ),
  ).toBe(`{\n  "k": { "one": "x", "other": "y" }\n}\n`);
});

test("a JSON target built from the template keeps the template's line endings and BOM (#850)", () => {
  const crlf = '{\r\n  "a": "A",\r\n  "b": "B"\r\n}\r\n';
  expect(entriesToMessages(crlf, { a: "X" }, undefined, { locale: "fr" })).toBe(
    '{\r\n  "@@locale": "fr",\r\n  "a": "X"\r\n}\r\n',
  );
  const bom = '﻿{\n  "a": "A"\n}\n';
  expect(entriesToMessages(bom, { a: "X" }, "")).toBe('﻿{\n  "a": "X"\n}\n');
});

test("a table keeps its file's line endings and BOM, and a new one takes the template's (#883)", () => {
  const crlf = (text: string) => "﻿" + text.replace(/\n/g, "\r\n");
  const target = crlf(TABLE);
  const texts = { "step.1": "Abre a porta.", "step.2": "Procura a chave." };
  // A pull of the file's own texts leaves every byte.
  expect(entriesToTable(target, texts, MAP, target)).toBe(target);
  const edited = entriesToTable(
    target,
    { ...texts, "step.1": "Open the door." },
    MAP,
    target,
  );
  expect(edited).toBe(crlf(TABLE.replace("Abre a porta.", "Open the door.")));
  // A new file, and a blank one, start from the template's.
  expect(entriesToTable(target, texts, MAP)).toBe(target);
  expect(entriesToTable(target, texts, MAP, "")).toBe(target);
  // The expanded layout too, and a proposal's ops.
  const expanded = crlf(JSON.stringify(JSON.parse(TABLE), null, 2) + "\n");
  expect(entriesToTable(expanded, texts, MAP, expanded)).toBe(expanded);
  expect(applyTableOps(target, [{ kind: "delete", id: "step.2" }], MAP)).toBe(
    crlf(`[
  { "id": "step.1", "text": "Abre a porta.", "kind": "hint" }
]
`),
  );
  // A blank file with nothing translated yet settles at once: a second
  // pull leaves what the first wrote.
  const first = entriesToTable(target, {}, MAP, "");
  expect(first).toBe("\uFEFF[]\r\n");
  expect(entriesToTable(target, {}, MAP, first)).toBe(first);
  // An LF file stays LF with no BOM.
  expect(entriesToTable(TABLE, texts, MAP, TABLE)).toBe(TABLE);
});

test("a table file with no records takes the template's layout, as a blank one does (#927)", () => {
  const texts = { "step.1": "Open the door." };
  const fresh = entriesToTable(TABLE, texts, MAP);
  // Blank, then settled at [], then translated: the template's one record
  // a line, and a second pull leaves it.
  const settled = entriesToTable(TABLE, {}, MAP, "");
  expect(settled).toBe("[]\n");
  const translated = entriesToTable(TABLE, texts, MAP, settled);
  expect(translated).toBe(fresh);
  expect(entriesToTable(TABLE, texts, MAP, translated)).toBe(translated);
  // The same after a proposal removes a one-per-line table's last record.
  const emptied = applyTableOps(
    `[\n  { "id": "step.1", "text": "Abre a porta." }\n]\n`,
    [{ kind: "delete", id: "step.1" }],
    MAP,
  );
  expect(entriesToTable(TABLE, texts, MAP, emptied)).toBe(fresh);
  // Nothing to write leaves such a file as it is, byte for byte.
  for (const empty of ["[]", "[]\r\n", "\uFEFF[]\r\n"])
    expect(entriesToTable(TABLE, {}, MAP, empty)).toBe(empty);
  // A translation takes the template's layout, the file's own BOM and
  // line endings kept.
  expect(entriesToTable(TABLE, texts, MAP, "\uFEFF[]\r\n")).toBe(
    "\uFEFF" + fresh.replace(/\n/g, "\r\n"),
  );
  // With no line break of its own, the template's.
  expect(entriesToTable(TABLE, texts, MAP, "[]")).toBe(fresh);
});

describe("a target's plural object without other writes back as the file has it (#950)", () => {
  const source = `{
  "rooms": {
    "one": "%(count)s room",
    "other": "%(count)s rooms"
  }
}
`;
  const target = `{
  "rooms": {
    "one": "%(count)s pokój",
    "few": "%(count)s pokoje",
    "many": "%(count)s pokoi"
  }
}
`;
  test("its own forms pulled back change nothing, and nothing is refused", () => {
    const refused: string[] = [];
    expect(
      entriesToMessages(
        source,
        {
          rooms:
            "{count, plural, one {%(count)s pokój} few {%(count)s pokoje} many {%(count)s pokoi}}",
        },
        target,
        { plurals: true, onRefused: (id) => refused.push(id) },
      ),
    ).toBe(target);
    expect(refused).toEqual([]);
  });

  test("a draft that adds other changes that form alone", () => {
    expect(
      entriesToMessages(
        source,
        {
          rooms:
            "{count, plural, one {%(count)s pokój} few {%(count)s pokoje} many {%(count)s pokoi} other {%(count)s pokoju}}",
        },
        target,
        { plurals: true },
      ),
    ).toBe(`{
  "rooms": {
    "one": "%(count)s pokój",
    "few": "%(count)s pokoje",
    "many": "%(count)s pokoi",
    "other": "%(count)s pokoju"
  }
}
`);
  });
});

test("a pull writes a target's lone other where the source has a key there, never as a plural (#984)", () => {
  const source = `{\n  "cat": {\n    "other": "Other",\n    "more": "More"\n  }\n}\n`;
  const target = `{\n  "cat": {\n    "other": "Andere"\n  }\n}\n`;
  expect(
    entriesToMessages(source, { "cat.other": "Anderes" }, target, {
      plurals: true,
    }),
  ).toBe(`{\n  "cat": {\n    "other": "Anderes"\n  }\n}\n`);
  // Under i18next, a lone other in the source is a key too.
  const lone = `{\n  "cat": {\n    "other": "Other"\n  }\n}\n`;
  expect(
    entriesToMessages(
      lone,
      { "cat.other": "Andere" },
      lone.replace("Other", "X"),
      {
        plurals: "several",
      },
    ),
  ).toBe(lone.replace("Other", "Andere"));
});

describe("i18next's plural keys are written as the family they are (#985)", () => {
  const source = `{\n  "a": {\n    "title_one": "{{count}} source",\n    "title_other": "{{count}} sources",\n    "next": "Next"\n  }\n}\n`;
  const pl = `{\n  "a": {\n    "title_one": "{{count}} źródło",\n    "title_other": "{{count}} źródeł",\n    "next": "Dalej"\n  }\n}\n`;
  const opts = { plurals: "several" as const, suffixPlurals: true };
  test("a draft's new forms go beside the family, in CLDR's order, and nothing else changes", () => {
    expect(
      entriesToMessages(
        source,
        {
          "a.title":
            "{count, plural, one {{{count}} źródło} few {{{count}} źródła} many {{{count}} źródeł} other {{{count}} źródła!}}",
        },
        pl,
        opts,
      ),
    ).toBe(
      `{\n  "a": {\n    "title_one": "{{count}} źródło",\n    "title_few": "{{count}} źródła",\n    "title_many": "{{count}} źródeł",\n    "title_other": "{{count}} źródła!",\n    "next": "Dalej"\n  }\n}\n`,
    );
  });
  test("its own forms pulled back change nothing; a form the text lacks stays", () => {
    const ja = `{\n  "a": {\n    "title_one": "{{count}} 件",\n    "title_other": "{{count}} 件",\n    "next": "次"\n  }\n}\n`;
    expect(
      entriesToMessages(
        source,
        {
          "a.title": "{count, plural, one {{{count}} 件} other {{{count}} 件}}",
          "a.next": "次",
        },
        ja,
        opts,
      ),
    ).toBe(ja);
    expect(
      entriesToMessages(
        source,
        { "a.title": "{count, plural, other {{{count}} 件!}}" },
        ja,
        opts,
      ),
    ).toBe(
      ja.replace(
        '"title_other": "{{count}} 件"',
        '"title_other": "{{count}} 件!"',
      ),
    );
  });
  test("a file started from the template holds the text's forms alone", () => {
    expect(
      JSON.parse(
        entriesToMessages(
          source,
          { "a.title": "{count, plural, other {{{count}} 件}}" },
          undefined,
          opts,
        ),
      ),
    ).toEqual({ a: { title_other: "{{count}} 件" } });
  });
  test("a removal takes the family whole, from a target however few its forms; a proposed plural is written as keys", () => {
    const ja = `{\n  "a": {\n    "title_other": "{{count}} 件",\n    "next": "次"\n  }\n}\n`;
    expect(
      JSON.parse(
        applyMessagesOps(ja, [{ kind: "delete", id: "a.title" }], {
          ...opts,
          pluralIds: new Set(["a.title"]),
        }),
      ),
    ).toEqual({ a: { next: "次" } });
    expect(
      JSON.parse(
        applyMessagesOps(
          source,
          [
            {
              kind: "add",
              id: "a.files",
              text: "{count, plural, one {{{count}} file} other {{{count}} files}}",
            },
            {
              kind: "edit",
              id: "a.title",
              text: "{count, plural, other {{{count}} sources}}",
            },
          ],
          opts,
        ),
      ),
    ).toEqual({
      a: {
        title_other: "{{count}} sources",
        next: "Next",
        files_one: "{{count}} file",
        files_other: "{{count}} files",
      },
    });
  });
});

test("a pull leaves a bare key beside a target's family, and a proposed plural in a file of objects is an object (#985 review)", () => {
  const source = `{\n  "item_one": "{{count}} item",\n  "item_other": "{{count}} items"\n}\n`;
  const de = `{\n  "item": "Alt",\n  "item_one": "{{count}} Element",\n  "item_other": "{{count}} Elemente"\n}\n`;
  expect(
    entriesToMessages(
      source,
      {
        item: "{count, plural, one {{{count}} Element} other {{{count}} Elemente!}}",
      },
      de,
      { plurals: "several", suffixPlurals: true, sourceLanguage: "en" },
    ),
  ).toBe(de.replace('Elemente"', 'Elemente!"'));
  const objects = `{\n  "calls": {\n    "one": "{{count}} call",\n    "other": "{{count}} calls"\n  }\n}\n`;
  expect(
    JSON.parse(
      applyMessagesOps(
        objects,
        [
          {
            kind: "add",
            id: "files",
            text: "{count, plural, one {{{count}} file} other {{{count}} files}}",
          },
        ],
        { plurals: "several", suffixPlurals: true, sourceLanguage: "en" },
      ),
    ),
  ).toEqual({
    calls: { one: "{{count}} call", other: "{{count}} calls" },
    files: { one: "{{count}} file", other: "{{count}} files" },
  });
});

test("a null, number or list the file holds is left as it is; a translation under a list is named (#1026)", () => {
  const template = `{ "a": "Apple", "v": null, "n": 2, "l": ["x", null], "c": { "d": "D" } }\n`;
  const de = `{ "a": "Apfel", "v": null, "n": 2, "l": ["y", null], "c": ["z"] }\n`;
  expect(entriesToMessages(template, { a: "Apfel" }, de)).toBe(de);
  const listed: string[] = [];
  expect(
    entriesToMessages(template, { a: "Apfel", "c.d": "Dd" }, de, {
      onList: (id) => listed.push(id),
    }),
  ).toBe(de);
  expect(listed).toEqual(["c.d"]);
  // A first pull into a missing file, and a proposal into the source.
  expect(() => entriesToMessages(template, { a: "Apfel" })).not.toThrow();
  expect(
    applyMessagesOps(template, [{ kind: "edit", id: "a", text: "Apples" }]),
  ).toBe(template.replace('"Apple"', '"Apples"'));
});

test("removing a plural id takes a target's object of categories whole, other or not, where the source reads the id as a plural; elsewhere it is a section (#959, #984)", () => {
  const remove = (text: string, id: string, pluralIds: string[]) =>
    applyMessagesOps(text, [{ kind: "delete", id }], {
      plurals: true,
      pluralIds: new Set(pluralIds),
    });
  for (const forms of ['"one": "a", "other": "b"', '"one": "a", "few": "b"'])
    expect(remove(`{\n  "r": { ${forms} },\n  "k": "v"\n}\n`, "r", ["r"])).toBe(
      '{\n  "k": "v"\n}\n',
    );
  expect(
    remove(
      '{\n  "m.room": { "one": "a", "few": "b" },\n  "k": "v"\n}\n',
      "m.room",
      ["m.room"],
    ),
  ).toBe('{\n  "k": "v"\n}\n');
  // An object with another key is a section, and so is one at an id the
  // source holds as a string: `r.one` may be a string of its own.
  const section = '{\n  "r": { "one": "a", "label": "b" },\n  "k": "v"\n}\n';
  expect(remove(section, "r", ["r"])).toBe(section);
  const plain = '{\n  "r": { "one": "a", "few": "b" },\n  "k": "v"\n}\n';
  expect(remove(plain, "r", [])).toBe(plain);
});

test("an entry-object catalogue takes a translation into its text field only, every other byte kept (#1001)", () => {
  const template = `{
  "smartling": {
    "translate_paths": [{ "path": "*/messageformat" }]
  },
  "icu:Greeting": {
    "messageformat": "Hello {name}",
    "description": "Shown on the home screen",
    "ignoreUnused": true
  },
  "icu:Bye": {
    "messageformat": "Bye",
    "description": "Leaving"
  }
}
`;
  const existing = `{
  "icu:Greeting": {
    "messageformat": "Hallo {name}",
    "description": "Shown on the home screen",
    "ignoreUnused": true
  }
}
`;
  const entries = { text: "messageformat", note: "description" };
  expect(
    entriesToMessages(template, { "icu:Greeting": "Hallo {name}" }, existing, {
      entries,
    }),
  ).toBe(existing);
  expect(
    entriesToMessages(
      template,
      { "icu:Greeting": "Servus {name}", "icu:Bye": "Tschüss" },
      existing,
      { entries },
    ),
  ).toBe(`{
  "icu:Greeting": {
    "messageformat": "Servus {name}",
    "description": "Shown on the home screen",
    "ignoreUnused": true
  },
  "icu:Bye": {
    "messageformat": "Tschüss"
  }
}
`);
  // A new file holds the text field alone, as a new entry does.
  expect(
    entriesToMessages(template, { "icu:Bye": "Tschüss" }, undefined, {
      entries,
    }),
  ).toBe(`{
  "icu:Bye": {
    "messageformat": "Tschüss"
  }
}
`);
  // A value that is no entry is the file's: refused, and left.
  const refused: string[] = [];
  const odd = `{\n  "icu:Greeting": "plain",\n  "icu:Bye": { "messageformat": { "x": "y" } }\n}\n`;
  expect(
    entriesToMessages(
      template,
      { "icu:Greeting": "Hallo", "icu:Bye": "Tschüss" },
      odd,
      { entries, onRefused: (id) => refused.push(id) },
    ),
  ).toBe(odd);
  expect(refused).toEqual(["icu:Greeting", "icu:Bye"]);
});

describe("a target's plural object with a broken form is the source's plural, pulled back unchanged or fixed in place (#960)", () => {
  const source = `{\n  "rooms": {\n    "one": "{count} room",\n    "other": "{count} rooms"\n  }\n}\n`;
  const target = `{\n  "rooms": {\n    "one": "{count} pokój }",\n    "few": "{count} pokoje",\n    "other": "{count} pokoi"\n  }\n}\n`;
  const broken =
    "{count, plural, one {{count} pokój }} few {{count} pokoje} other {{count} pokoi}}";
  test("its own text pulled back changes nothing, and nothing is refused", () => {
    const refused: string[] = [];
    expect(
      entriesToMessages(source, { rooms: broken }, target, {
        plurals: true,
        onRefused: (id) => refused.push(id),
      }),
    ).toBe(target);
    expect(refused).toEqual([]);
  });
  test("a fixed translation rewrites the broken form alone", () => {
    expect(
      entriesToMessages(
        source,
        {
          rooms:
            "{count, plural, one {{count} pokój} few {{count} pokoje} other {{count} pokoi}}",
        },
        target,
        { plurals: true },
      ),
    ).toBe(target.replace("{count} pokój }", "{count} pokój"));
  });
});

describe("under i18next a target's plural in the other shape than the source's, an object or suffix keys, is written in its own shape (#1187)", () => {
  const options = {
    plurals: "several",
    suffixPlurals: true,
    sourceLanguage: "en",
  } as const;
  const suffixSource = `{\n  "rooms_one": "{{count}} room",\n  "rooms_other": "{{count}} rooms"\n}\n`;
  const objectTarget = `{\n  "rooms": {\n    "one": "{{count}} pokój",\n    "few": "{{count}} pokoje",\n    "other": "{{count}} pokoi"\n  }\n}\n`;
  const objectSource = `{\n  "rooms": {\n    "one": "{{count}} room",\n    "other": "{{count}} rooms"\n  }\n}\n`;
  const suffixTarget = `{\n  "rooms_one": "{{count}} pokój",\n  "rooms_few": "{{count}} pokoje",\n  "rooms_other": "{{count}} pokoi"\n}\n`;
  const plural =
    "{count, plural, one {{{count}} pokój} few {{{count}} pokoje} other {{{count}} pokoi}}";
  const changed = plural.replace("pokoje}", "pokoje!}");
  test("its own text pulled back changes nothing", () => {
    expect(
      entriesToMessages(suffixSource, { rooms: plural }, objectTarget, options),
    ).toBe(objectTarget);
    expect(
      entriesToMessages(objectSource, { rooms: plural }, suffixTarget, options),
    ).toBe(suffixTarget);
  });
  test("a changed translation edits the target's own shape in place", () => {
    expect(
      entriesToMessages(
        suffixSource,
        { rooms: changed },
        objectTarget,
        options,
      ),
    ).toBe(objectTarget.replace('pokoje"', 'pokoje!"'));
    expect(
      entriesToMessages(
        objectSource,
        { rooms: changed },
        suffixTarget,
        options,
      ),
    ).toBe(suffixTarget.replace('pokoje"', 'pokoje!"'));
  });
  test("a target that lacks the plural takes the source's shape", () => {
    expect(
      entriesToMessages(suffixSource, { rooms: plural }, `{}\n`, options),
    ).toMatch(/"rooms_few"/);
    expect(
      entriesToMessages(objectSource, { rooms: plural }, `{}\n`, options),
    ).toMatch(/"rooms": \{/);
  });
});

test("a new target file is written from the source's own reading, so an object beside a sibling _other key is translated as on main (#1187 review)", () => {
  const source = `{\n  "rooms": {\n    "one": "{{count}} room",\n    "other": "{{count}} rooms"\n  },\n  "rooms_other": "Other rooms"\n}\n`;
  const out = entriesToMessages(
    source,
    {
      rooms: "{count, plural, one {{{count}} pokój} other {{{count}} pokoi}}",
      rooms_other: "Inne pokoje",
    },
    undefined,
    { plurals: "several", suffixPlurals: true, sourceLanguage: "en" },
  );
  expect(out).not.toMatch(/room"/);
  expect(out).toMatch(/"one": "\{\{count\}\} pokój"/);
  expect(out).toMatch(/"rooms_other": "Inne pokoje"/);
});

test("a pull into an empty {} target writes one key per line in the source's indent; a pull of nothing leaves {} as it is (#1041)", () => {
  const source = `{\n    "a": "A",\n    "nested": {\n        "b": "B"\n    }\n}\n`;
  expect(entriesToMessages(source, { a: "Á", "nested.b": "Bé" }, "{}\n")).toBe(
    `{\n    "a": "Á",\n    "nested": {\n        "b": "Bé"\n    }\n}\n`,
  );
  expect(entriesToMessages(source, { a: "Á" }, "{}")).toBe(
    `{\n    "a": "Á"\n}`,
  );
  expect(entriesToMessages(source, {}, "{}\n")).toBe("{}\n");
  // An ARB with only its locale keeps its own layout.
  const arb = `{\n  "@@locale": "gl"\n}\n`;
  expect(entriesToMessages(source, { a: "Á" }, arb)).toBe(
    `{\n  "@@locale": "gl",\n  "a": "Á"\n}\n`,
  );
  // A target written on one line with keys keeps its line.
  expect(entriesToMessages(source, { a: "Á" }, `{ "z": "Z" }\n`)).toBe(
    `{ "z": "Z", "a": "Á" }\n`,
  );
});

test("an empty {} target of a Chrome catalogue or of entry objects takes the given indent too, else the source's (#1041 review)", () => {
  const chrome = `{\n    "a": {\n        "message": "A"\n    }\n}\n`;
  expect(
    entriesToMessages(chrome, { a: "Á" }, "{}\n", {
      chrome: true,
      indent: "\t",
    }),
  ).toBe(`{\n\t"a": {\n\t\t"message": "Á"\n\t}\n}\n`);
  expect(entriesToMessages(chrome, { a: "Á" }, "{}\n", { chrome: true })).toBe(
    `{\n    "a": {\n        "message": "Á"\n    }\n}\n`,
  );
  const entries = `{\n    "a": {\n        "text": "A"\n    }\n}\n`;
  expect(
    entriesToMessages(entries, { a: "Á" }, "{}\n", {
      entries: { text: "text" },
      indent: "\t",
    }),
  ).toBe(`{\n\t"a": {\n\t\t"text": "Á"\n\t}\n}\n`);
});

describe("arrays (#1053)", () => {
  const template = `{
  "a": {
    "list": ["x", "y", "z"]
  },
  "b": [
    {
      "id": 0,
      "name": "N"
    }
  ],
  "c": "C"
}
`;
  test("an item's change touches only its bytes", () => {
    const de = template.replace('"x", "y"', '"X", "Y"');
    expect(entriesToMessages(template, { "a.list.1": "Ypsilon" }, de)).toBe(
      de.replace('"Y"', '"Ypsilon"'),
    );
  });
  test("a target without the array takes it up to the last item written, the source's text before it, the source's other members kept", () => {
    const de = `{\n  "c": "Ce"\n}\n`;
    expect(
      entriesToMessages(
        template,
        { "a.list.1": "Ypsilon", "b.0.name": "Nn" },
        de,
      ),
    ).toBe(
      `{\n  "a": {\n    "list": [\n      "x",\n      "Ypsilon"\n    ]\n  },\n  "b": [\n    {\n      "id": 0,\n      "name": "Nn"\n    }\n  ],\n  "c": "Ce"\n}\n`,
    );
  });
  test("a short array is filled to the item written", () => {
    const de = template.replace('["x", "y", "z"]', '["X"]');
    expect(entriesToMessages(template, { "a.list.2": "Zett" }, de)).toBe(
      template.replace('["x", "y", "z"]', '["X", "y", "Zett"]'),
    );
  });
  test("a missing file keeps an array to its last translated item, and drops one with none", () => {
    const out = JSON.parse(
      entriesToMessages(template, { "a.list.1": "Ypsilon" }, undefined),
    );
    expect(out).toEqual({ a: { list: ["x", "Ypsilon"] } });
  });
  test("an item that lacks a key takes it inside the item, never as a dotted key at the root", () => {
    const source = `{\n  "b": [\n    { "id": 0, "name": "N", "group": "G" }\n  ]\n}\n`;
    const de = `{\n  "b": [\n    { "id": 0, "name": "Nd" }\n  ]\n}\n`;
    const out = JSON.parse(
      entriesToMessages(source, { "b.0.group": "Gd" }, de),
    );
    expect(out).toEqual({ b: [{ id: 0, name: "Nd", group: "Gd" }] });
  });
  test("a plural object inside an item is written as one in a new file, refused where it cannot be", () => {
    const source = `{\n  "l": [\n    { "n": { "one": "# a", "other": "# as" } }\n  ]\n}\n`;
    const out = JSON.parse(
      entriesToMessages(
        source,
        { "l.0.n": "{count, plural, one {# x} other {# xs}}" },
        undefined,
        { plurals: true },
      ),
    );
    expect(out).toEqual({ l: [{ n: { one: "# x", other: "# xs" } }] });
    const refused: string[] = [];
    entriesToMessages(
      source,
      { "l.0.n": "{count, plural, =0 {none} one {# x} other {# xs}}" },
      undefined,
      { plurals: true, onRefused: (id) => refused.push(id) },
    );
    expect(refused).toEqual(["l.0.n"]);
  });
  test("i18next's plural keys inside an item are one string, read and written as such", () => {
    const source = `{\n  "opts": [\n    { "item_one": "one", "item_other": "many" }\n  ]\n}\n`;
    expect(
      messagesToEntries(JSON.parse(source), {
        type: "ui",
        suffixPlurals: true,
        sourceLanguage: "en",
      }).map((e) => e.id),
    ).toEqual(["opts.0.item"]);
    const plural = "{count, plural, one {eins} other {viele}}";
    for (const existing of [source, undefined])
      expect(
        JSON.parse(
          entriesToMessages(source, { "opts.0.item": plural }, existing, {
            suffixPlurals: true,
            sourceLanguage: "en",
          }),
        ),
      ).toEqual({ opts: [{ item_one: "eins", item_other: "viele" }] });
  });
  test("a blank target takes the source's lists as a missing file does, never as objects", () => {
    expect(
      JSON.parse(entriesToMessages(template, { "a.list.1": "Ypsilon" }, "")),
    ).toEqual({ a: { list: ["x", "Ypsilon"] } });
  });
  test("a removal of an id the file does not hold is nothing, where its path meets a list", () => {
    expect(
      applyMessagesOps(template, [{ kind: "delete", id: "a.list.7" }]),
    ).toBe(template);
  });
  test("a proposal edits an item; adding or removing one, which renumbers those after it, is refused by name", () => {
    expect(
      applyMessagesOps(template, [
        { kind: "edit", id: "a.list.0", text: "ex" },
      ]),
    ).toBe(template.replace('["x"', '["ex"'));
    for (const op of [
      { kind: "add", id: "a.list.3", text: "w", type: "ui" },
      { kind: "delete", id: "a.list.1" },
    ] as const)
      expect(() => applyMessagesOps(template, [op as never])).toThrow(
        /a\.list\.\d is an item of a list/,
      );
  });
});

describe("a list's items made whole (#1053)", () => {
  const objects = `{\n  "opts": [\n    { "name": "N", "n": { "one": "# a", "other": "# as" } }\n  ]\n}\n`;
  const families = `{\n  "opts": [\n    { "name": "N", "item_one": "one", "item_other": "many" }\n  ]\n}\n`;
  const tags = `{\n  "opts": [\n    { "name": "N", "tags": ["A", "B"] }\n  ]\n}\n`;
  const write = (
    template: string,
    translations: Record<string, string>,
    existing: string | undefined,
    options: Parameters<typeof entriesToMessages>[3] = {},
  ) => {
    const named: string[] = [];
    const text = entriesToMessages(template, translations, existing, {
      ...options,
      onList: (id) => named.push(id),
      onRefused: (id) => named.push(id),
    });
    return { out: JSON.parse(text) as unknown, named };
  };
  const forms = "{count, plural, one {# x} other {# xs}}";
  test("an item copied in from the source takes a plural translation as a plural, an object's or a family's", () => {
    for (const de of [`{ "x": "Xe" }\n`, "{}\n"]) {
      expect(
        write(objects, { "opts.0.n": forms }, de, { plurals: true }),
      ).toEqual({
        out: {
          ...(de.includes("x") && { x: "Xe" }),
          opts: [{ name: "N", n: { one: "# x", other: "# xs" } }],
        },
        named: [],
      });
      expect(
        write(families, { "opts.0.item": forms }, de, {
          suffixPlurals: true,
          sourceLanguage: "en",
        }).out,
      ).toEqual({
        ...(de.includes("x") && { x: "Xe" }),
        opts: [{ name: "N", item_one: "# x", item_other: "# xs" }],
      });
    }
  });
  test("two lists an empty target lacks each take their own items", () => {
    // Both under one key the target lacks, so one build sees both.
    const source = `{\n  "r": {\n    "a": { "l": [{ "k": "K", "m": "M" }] },\n    "b": { "c": { "l": ["x", "y"] } }\n  }\n}\n`;
    expect(
      write(source, { "r.a.l.0.k": "Kd", "r.b.c.l.1": "Yd" }, "{}\n").out,
    ).toEqual({
      r: { a: { l: [{ k: "Kd", m: "M" }] }, b: { c: { l: ["x", "Yd"] } } },
    });
  });
  test("a short list's items written in any order are each written once, none named", () => {
    expect(
      write(
        `{\n  "l": ["a", "b", "c", "d"]\n}\n`,
        { "l.3": "D", "l.2": "C" },
        `{\n  "l": ["A", "B"]\n}\n`,
      ),
    ).toEqual({ out: { l: ["A", "B", "C", "D"] }, named: [] });
  });
  test("a plural where an item holds a string becomes the plural, as outside a list; one where it holds a list is named", () => {
    expect(
      write(
        objects,
        { "opts.0.n": forms },
        `{\n  "opts": [\n    { "n": "%{count} Dinge" }\n  ]\n}\n`,
        { plurals: true },
      ),
    ).toEqual({
      out: { opts: [{ n: { one: "# x", other: "# xs" } }] },
      named: [],
    });
    const items = `{\n  "l": [\n    { "one": "# a", "other": "# as" }\n  ]\n}\n`;
    expect(
      write(items, { "l.0": forms }, `{\n  "l": ["S"]\n}\n`, { plurals: true }),
    ).toEqual({ out: { l: [{ one: "# x", other: "# xs" }] }, named: [] });
    expect(
      write(
        objects,
        { "opts.0.n": forms },
        `{\n  "opts": [\n    { "n": ["x", "y"] }\n  ]\n}\n`,
        { plurals: true },
      ).named,
    ).toEqual(["opts.0.n"]);
    for (const de of [`{\n  "opts": [["x"]]\n}\n`, `{\n  "opts": ["S"]\n}\n`]) {
      const { out, named } = write(families, { "opts.0.item": forms }, de, {
        suffixPlurals: true,
        sourceLanguage: "en",
      });
      expect(named).toEqual(["opts.0.item"]);
      expect(out).toEqual(JSON.parse(de));
    }
  });
  test("a plural refused under a part the target lacks is said once", () => {
    const nested = `{\n  "r": {\n    "opts": [\n      { "n": { "one": "# a", "other": "# as" } }\n    ]\n  }\n}\n`;
    expect(
      write(
        nested,
        { "r.opts.0.n": "{count, plural, =0 {none} one {# x} other {# xs}}" },
        "{}\n",
        { plurals: true },
      ).named,
    ).toEqual(["r.opts.0.n"]);
  });
  test("an item that lacks a plural takes it as a plural, never as an ICU text", () => {
    const de = `{\n  "opts": [\n    { "name": "Nd" }\n  ]\n}\n`;
    expect(
      write(objects, { "opts.0.n": forms }, de, { plurals: true }).out,
    ).toEqual({
      opts: [{ name: "Nd", n: { one: "# x", other: "# xs" } }],
    });
    expect(
      write(families, { "opts.0.item": forms }, de, {
        suffixPlurals: true,
        sourceLanguage: "en",
      }).out,
    ).toEqual({ opts: [{ name: "Nd", item_one: "# x", item_other: "# xs" }] });
  });
  test("a list inside an item, missing or short, takes the source's items; a shape the source does not have is named", () => {
    expect(
      write(
        tags,
        { "opts.0.tags.1": "Bd" },
        `{\n  "opts": [\n    { "name": "Nd" }\n  ]\n}\n`,
      ).out,
    ).toEqual({ opts: [{ name: "Nd", tags: ["A", "Bd"] }] });
    expect(
      write(
        tags,
        { "opts.0.tags.1": "Bd" },
        `{\n  "opts": [\n    { "name": "Nd", "tags": ["Ad"] }\n  ]\n}\n`,
      ).out,
    ).toEqual({ opts: [{ name: "Nd", tags: ["Ad", "Bd"] }] });
    for (const shape of [`{ "x": "y" }`, `"T"`])
      expect(
        write(
          tags,
          { "opts.0.tags.1": "Bd" },
          `{\n  "opts": [\n    { "name": "Nd", "tags": ${shape} }\n  ]\n}\n`,
        ).named,
      ).toEqual(["opts.0.tags.1"]);
    // A string where the source has an object is named, never a flat key.
    const sub = `{\n  "b": [\n    { "sub": { "k": "K" } }\n  ]\n}\n`;
    const { out, named } = write(
      sub,
      { "b.0.sub.k": "Kd" },
      `{\n  "b": [\n    { "sub": "S" }\n  ]\n}\n`,
    );
    expect(named).toEqual(["b.0.sub.k"]);
    expect(out).toEqual({ b: [{ sub: "S" }] });
  });
});
