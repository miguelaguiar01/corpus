// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { moonlightManor, validateTranslation } from "@corpus/contract";
import { TargetPane } from "./target-pane";

afterEach(cleanup);

const SOURCE = "{witness} viu {suspect} às {hour}.";
const slots = [
  { name: "witness", description: "Who saw it" },
  { name: "suspect", description: "Who was seen" },
  { name: "hour", description: "Time" },
];

function pane(initialText = "") {
  const action = vi.fn();
  render(
    <TargetPane
      action={action}
      source={SOURCE}
      slots={slots}
      language="en"
      initialText={initialText}
      slug="mm"
      stringKey="k"
      openedVersion={1}
      sourceLanguage="pt-PT"
    />,
  );
  const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
  const save = screen.getByRole("button", {
    name: "Save translation",
  }) as HTMLButtonElement;
  return { action, textarea, save };
}

// A preview line is several spans; read the region's text.
const previewText = () =>
  screen.getByRole("region", { name: /Preview/ }).textContent ?? "";

const sighting = moonlightManor.strings[0]!;

test("a select chip inserts the skeleton with the source's keys, caret in the first branch", () => {
  const action = vi.fn();
  render(
    <TargetPane
      action={action}
      source={sighting.source}
      slots={[]}
      language="en"
      initialText=""
      slug="mm"
      stringKey="k"
      openedVersion={1}
      sourceLanguage="pt-PT"
    />,
  );
  const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
  // Two selects on person_gender in the source, one chip.
  fireEvent.click(
    screen.getByRole("button", { name: "{person_gender, select}" }),
  );
  expect(textarea.value).toBe("{person_gender, select, m {} f {}}");
});

test("the preview renders each example's branch from the draft", () => {
  render(
    <TargetPane
      action={vi.fn()}
      source={sighting.source}
      slots={[]}
      language="en"
      initialText="{person} was {person_gender, select, m {seen} f {spotted}}."
      slug="mm"
      stringKey="k"
      openedVersion={1}
      examples={sighting.examples ?? []}
      sourceLanguage="pt-PT"
    />,
  );
  // The fixture carries English values, so the preview is in English.
  const preview = screen.getByRole("region", {
    name: "Preview with en values",
  });
  expect(preview.textContent).toContain("was spotted");
  expect(preview.textContent).toContain("was seen");
});

test("the preview shows the example's values in the quiet tone", () => {
  render(
    <TargetPane
      action={vi.fn()}
      source={sighting.source}
      slots={[]}
      language="fr"
      initialText="{person} was seen at the {room_de} window."
      slug="mm"
      stringKey="k"
      openedVersion={1}
      examples={sighting.examples ?? []}
      sourceLanguage="pt-PT"
    />,
  );
  const value = screen.getByText("da estufa");
  expect(value.className).toMatch(/text-muted-foreground/);
  expect(
    screen.getAllByText("was seen at the")[0]?.className ?? "",
  ).not.toMatch(/text-muted-foreground/);
});

test("tapping a placeholder chip inserts it at the caret", () => {
  const { textarea } = pane("saw  at");
  textarea.setSelectionRange(4, 4);
  fireEvent.click(screen.getByRole("button", { name: "{suspect}" }));
  expect(textarea.value).toBe("saw {suspect} at");
});

test("a draft missing a placeholder names it and disables save", () => {
  const { save } = pane("{witness} saw someone at {hour}.");
  expect(screen.getByText("Missing {suspect}")).toBeTruthy();
  expect(save.disabled).toBe(true);
});

test("an unexpected placeholder is named", () => {
  pane("{witness} saw {suspect} at {hour} with {weapon}.");
  expect(screen.getByText("Unexpected {weapon}")).toBeTruthy();
});

test("a valid draft enables save; an empty draft disables it without shouting", () => {
  const { textarea, save } = pane("{witness} saw {suspect} at {hour}.");
  expect(save.disabled).toBe(false);
  expect(screen.queryByRole("alert")).toBeNull();
  fireEvent.change(textarea, { target: { value: "" } });
  expect(save.disabled).toBe(true);
  expect(screen.queryByRole("alert")).toBeNull();
});

test("the form carries the row and the version token", () => {
  const { textarea } = pane("x");
  const form = textarea.closest("form")!;
  const value = (name: string) =>
    form.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.value;
  expect(value("slug")).toBe("mm");
  expect(value("key")).toBe("k");
  expect(value("language")).toBe("en");
  expect(value("openedVersion")).toBe("1");
  expect(textarea.name).toBe("text");
});

const EXAMPLES = [
  {
    values: { witness: "a Condessa", suspect: "o Doutor", hour: "21h" },
    rendered: "A Condessa viu o Doutor às 21h.",
  },
  {
    values: { witness: "o mordomo", suspect: "a Condessa", hour: "23h" },
    rendered: "O mordomo viu a Condessa às 23h.",
  },
];

function paneWithExamples(initialText = "") {
  render(
    <TargetPane
      action={vi.fn()}
      source={SOURCE}
      slots={slots}
      language="en"
      initialText={initialText}
      slug="mm"
      stringKey="k"
      openedVersion={1}
      sourceLanguage="pt-PT"
      examples={EXAMPLES}
    />,
  );
  return screen.getByRole("textbox") as HTMLTextAreaElement;
}

test("with no draft, the previews are the examples' own renders", () => {
  paneWithExamples();
  expect(screen.getByText("A Condessa viu o Doutor às 21h.")).toBeTruthy();
  expect(screen.getByText("O mordomo viu a Condessa às 23h.")).toBeTruthy();
});

test("the previews follow the draft, one per example, values substituted", () => {
  const textarea = paneWithExamples("{witness} saw {suspect} at {hour}.");
  expect(previewText()).toContain("A Condessa saw o Doutor at 21h.");
  fireEvent.change(textarea, {
    target: { value: "At {hour}, {witness} saw {suspect}." },
  });
  expect(previewText()).toContain("At 21h, a Condessa saw o Doutor.");
  expect(previewText()).toContain("At 23h, o mordomo saw a Condessa.");
});

test("a draft with a select renders each example through its own branch", () => {
  render(
    <TargetPane
      action={vi.fn()}
      source="{g, select, m {Ele} f {Ela}} saiu."
      slots={[]}
      language="en"
      initialText="{g, select, m {He} f {She}} left."
      slug="mm"
      stringKey="k"
      openedVersion={1}
      sourceLanguage="pt-PT"
      examples={[
        { values: { g: "m" }, rendered: "Ele saiu." },
        { values: { g: "f" }, rendered: "Ela saiu." },
      ]}
    />,
  );
  expect(previewText()).toContain("He left.");
  expect(previewText()).toContain("She left.");
});

test("without examples there is no preview section", () => {
  pane("x");
  expect(screen.queryByRole("region", { name: "Preview" })).toBeNull();
});

test("with values for the target language, the preview is the target sentence and the heading says so", () => {
  render(
    <TargetPane
      action={vi.fn()}
      source={sighting.source}
      slots={[{ name: "room_de", description: "Where, with its article" }]}
      language="en"
      initialText="{person} was seen at the {room_de} window at {hour}."
      slug="mm"
      stringKey="k"
      openedVersion={1}
      examples={sighting.examples ?? []}
      sourceLanguage="pt-PT"
    />,
  );
  expect(
    screen.getByRole("region", { name: "Preview with en values" }),
  ).toBeTruthy();
  expect(previewText()).toContain(
    "Countess Rosa was seen at the greenhouse window at 9 pm.",
  );
  expect(previewText()).toContain(
    "Doctor Vaz was seen at the drawing room window at 11 pm.",
  );
  const chip = screen.getByRole("button", { name: "{room_de}" });
  expect(chip.getAttribute("title")).toBe(
    "Where, with its article\ngreenhouse",
  );
});

test("without values for the target language, the heading names the source language and chips keep only their description", () => {
  render(
    <TargetPane
      action={vi.fn()}
      source={sighting.source}
      slots={[{ name: "room_de", description: "Where, with its article" }]}
      language="fr"
      initialText="{person}"
      slug="mm"
      stringKey="k"
      openedVersion={1}
      examples={sighting.examples ?? []}
      sourceLanguage="pt-PT"
    />,
  );
  expect(
    screen.getByRole("region", { name: "Preview with pt-PT values" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "{room_de}" }).getAttribute("title"),
  ).toBe("Where, with its article");
});

test("a blank draft keeps the source-language heading over the examples' own renders", () => {
  render(
    <TargetPane
      action={vi.fn()}
      source={sighting.source}
      slots={[]}
      language="en"
      initialText=""
      slug="mm"
      stringKey="k"
      openedVersion={1}
      examples={sighting.examples ?? []}
      sourceLanguage="pt-PT"
    />,
  );
  const region = screen.getByRole("region", {
    name: "Preview with pt-PT values",
  });
  expect(region.textContent).toContain("A Condessa Rosa foi vista");
});

test("a chip with no description and a value shows the value alone; with neither, no title", () => {
  render(
    <TargetPane
      action={vi.fn()}
      source={sighting.source}
      slots={[{ name: "room_de" }, { name: "nowhere" }]}
      language="en"
      initialText="{room_de}"
      slug="mm"
      stringKey="k"
      openedVersion={1}
      examples={sighting.examples ?? []}
      sourceLanguage="pt-PT"
    />,
  );
  expect(
    screen.getByRole("button", { name: "{room_de}" }).getAttribute("title"),
  ).toBe("greenhouse");
  expect(
    screen.getByRole("button", { name: "{nowhere}" }).getAttribute("title"),
  ).toBeNull();
});

const PLURAL = "{n, plural, one {Falta # marca.} other {Faltam # marcas.}}";

function pluralPane(language: string, initialText = "", source = PLURAL) {
  render(
    <TargetPane
      action={vi.fn()}
      source={source}
      slots={[]}
      language={language}
      initialText={initialText}
      slug="mm"
      stringKey="k"
      openedVersion={1}
      examples={[
        { values: { n: "1" }, rendered: "Falta 1 marca." },
        { values: { n: "3" }, rendered: "Faltam 3 marcas." },
      ]}
      sourceLanguage="pt-PT"
    />,
  );
  return screen.getByRole("textbox") as HTMLTextAreaElement;
}

test("a plural chip inserts the target language's categories with # in each branch, caret after the first #", () => {
  const textarea = pluralPane("ru");
  fireEvent.click(screen.getByRole("button", { name: "{n, plural}" }));
  expect(textarea.value).toBe(
    "{n, plural, one {#} few {#} many {#} other {#}}",
  );
  cleanup();
  const exact = pluralPane(
    "en",
    "",
    "{n, plural, =0 {Nenhuma.} =1 {Uma.} one {#} other {#}}",
  );
  fireEvent.click(screen.getByRole("button", { name: "{n, plural}" }));
  expect(exact.value).toBe("{n, plural, =0 {#} =1 {#} one {#} other {#}}");
});

test("under i18next a plural chip fills each branch with the count's placeholder, under printf with nothing (#662, #689)", () => {
  for (const [syntax, fill, placeholder] of [
    ["i18next", "{{count}}", "{{count}}"],
    ["printf", "", "%d"],
    ["counterpart", "%(count)s", "%(count)s"],
    ["easy_localization", "{}", "{}"],
    ["rails", "%{count}", "%{count}"],
    ["qt", "%n", "%n"],
  ] as const) {
    render(
      <TargetPane
        action={vi.fn()}
        source={`{count, plural, one {${placeholder} room} other {${placeholder} rooms}}`}
        syntax={syntax}
        slots={[]}
        language="en"
        initialText=""
        slug="mm"
        stringKey="k"
        openedVersion={1}
        examples={[]}
        sourceLanguage="pt-PT"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /\{count, plural\}/ }));
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
      `{count, plural, one {${fill}} other {${fill}}}`,
    );
    cleanup();
  }
});

test("a plural draft previews each example through its count's branch, and a missing category is named without blocking the save (#556)", () => {
  pluralPane("en", "{n, plural, one {# mark left.} other {# marks left.}}");
  expect(previewText()).toContain("1 mark left.");
  expect(previewText()).toContain("3 marks left.");
  cleanup();
  pluralPane("ru", "{n, plural, one {# метка} other {# меток}}");
  expect(
    screen.getByText(
      "Plural n is missing the few branch the runtime picks in this language",
    ),
  ).toBeTruthy();
  // Incomplete, not invalid: the warning shows and the draft saves.
  expect(
    (
      screen.getByRole("button", {
        name: "Save translation",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(false);
});

test("a tag chip inserts the open and close tags with the caret between them; a dropped tag is named and disables save", () => {
  render(
    <TargetPane
      action={vi.fn()}
      source="See the <link>docs</link>."
      slots={[]}
      language="en"
      initialText=""
      slug="mm"
      stringKey="k"
      openedVersion={1}
      sourceLanguage="pt-PT"
    />,
  );
  const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
  fireEvent.click(screen.getByRole("button", { name: "<link>" }));
  expect(textarea.value).toBe("<link></link>");
  fireEvent.change(textarea, { target: { value: "See the docs." } });
  expect(screen.getByText("Missing the <link> tag")).toBeTruthy();
  expect(
    (
      screen.getByRole("button", {
        name: "Save translation",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});

test("under richText html a translation's own tags save, and its chips are the source's (#622)", () => {
  render(
    <TargetPane
      action={vi.fn()}
      source="See the <link>docs</link>."
      richText="html"
      slots={[]}
      language="en"
      initialText=""
      slug="mm"
      stringKey="k"
      openedVersion={1}
      sourceLanguage="pt-PT"
    />,
  );
  expect(screen.getByRole("button", { name: "<link>" })).toBeTruthy();
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "See the <i>docs</i>.<br/>" },
  });
  expect(screen.queryByText(/tag/)).toBeNull();
  expect(
    (
      screen.getByRole("button", {
        name: "Save translation",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(false);
});

test("an attributed tag's chip inserts it whole with the bare close, and a void tag's chip inserts it self-closed where the text is HTML (#590, #643)", () => {
  render(
    <TargetPane
      action={vi.fn()}
      source='Read the <a href="%s" target="_blank">docs</a>.<br>Then go.'
      syntax="android"
      slots={[]}
      language="en"
      initialText=""
      slug="mm"
      stringKey="k"
      openedVersion={1}
      sourceLanguage="pt-PT"
    />,
  );
  const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
  fireEvent.click(
    screen.getByRole("button", { name: '<a href="%s" target="_blank">' }),
  );
  expect(textarea.value).toBe('<a href="%s" target="_blank"></a>');
  fireEvent.click(screen.getByRole("button", { name: "<br>" }));
  expect(textarea.value).toBe('<a href="%s" target="_blank"></a><br/>');
  fireEvent.change(textarea, {
    target: { value: 'Lê a <a href="%s">documentação</a>.<br/>' },
  });
  expect(
    screen.getByText('Missing the <a href="%s" target="_blank"> tag'),
  ).toBeTruthy();
});

test("outside HTML a <br> chip inserts a pair, as the source writes it (#643)", () => {
  render(
    <TargetPane
      action={vi.fn()}
      source="Scroll<br></br>to zoom"
      slots={[]}
      language="en"
      initialText=""
      slug="mm"
      stringKey="k"
      openedVersion={1}
      sourceLanguage="pt-PT"
    />,
  );
  const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
  fireEvent.click(screen.getByRole("button", { name: "<br>" }));
  expect(textarea.value).toBe("<br></br>");
});

test("under printf a chip inserts the verb as the source writes it, and a dropped verb is named as written (#594)", () => {
  render(
    <TargetPane
      action={vi.fn()}
      source="%s pushed %d commits"
      syntax="printf"
      slots={[
        { name: "1", written: "%s" },
        { name: "2", written: "%d" },
      ]}
      language="pt-PT"
      initialText=""
      slug="mm"
      stringKey="k"
      openedVersion={1}
      sourceLanguage="en"
    />,
  );
  const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
  fireEvent.click(screen.getByRole("button", { name: "%d" }));
  expect(textarea.value).toBe("%d");
  fireEvent.change(textarea, { target: { value: "%s enviou commits" } });
  expect(screen.getByText("Missing %d")).toBeTruthy();
  fireEvent.change(textarea, { target: { value: "%d commits de %s" } });
  expect(
    screen.getByText(
      "%d at position 1 is %s in the source; a verb that moved needs its index, %n$d or %[n]d",
    ),
  ).toBeTruthy();
});

test("a select wrapped in a tag still gets its chip", () => {
  render(
    <TargetPane
      action={vi.fn()}
      source="<b>{g, select, m {he} f {she}}</b> left"
      slots={[]}
      language="en"
      initialText=""
      slug="mm"
      stringKey="k"
      openedVersion={1}
      sourceLanguage="pt-PT"
    />,
  );
  const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
  fireEvent.click(screen.getByRole("button", { name: "{g, select}" }));
  expect(textarea.value).toBe("{g, select, m {} f {}}");
});

test("an i18next string's chips insert {{name}}, and its validation reads {{ name }} as the placeholder", () => {
  render(
    <TargetPane
      action={vi.fn()}
      source="{{ count }} documents starred"
      syntax="i18next"
      slots={[{ name: "count" }]}
      language="pt-PT"
      initialText=""
      slug="mm"
      stringKey="k"
      openedVersion={1}
      sourceLanguage="en"
    />,
  );
  const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
  fireEvent.click(screen.getByRole("button", { name: "{{count}}" }));
  expect(textarea.value).toBe("{{count}}");
  fireEvent.change(textarea, { target: { value: "documentos marcados" } });
  expect(screen.getByText("Missing {{count}}")).toBeTruthy();
});

test("a draft carried back from a refused save names its fault (#529)", () => {
  // The page hands the refused text back as the pane's initial text;
  // the pane's own check lists what is wrong, so the server need not.
  const { save } = pane("{witness} saw someone at {hour}.");
  expect(screen.getByText("Missing {suspect}")).toBeTruthy();
  expect(save.disabled).toBe(true);
});

test("a nested argument's skeleton sits in each branch of its outer one's, the plural's in the target language's categories (#765)", () => {
  const textarea = pluralPane(
    "ru",
    "",
    "{g, select, female {{n, plural, one {Ela tem # ficheiro} other {Ela tem # ficheiros}}} other {{n, plural, one {# ficheiro} other {# ficheiros}}}}",
  );
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (run: FrameRequestCallback) =>
    frames.push(run),
  );
  fireEvent.click(screen.getByRole("button", { name: "{g, select}" }));
  vi.unstubAllGlobals();
  for (const run of frames) run(0);
  const inner = "{n, plural, one {#} few {#} many {#} other {#}}";
  expect(textarea.value).toBe(
    `{g, select, female {${inner}} other {${inner}}}`,
  );
  expect(textarea.selectionStart).toBe(
    "{g, select, female {{n, plural, one {#".length,
  );
  // The inner argument keeps a chip of its own.
  cleanup();
  const plain = pluralPane(
    "en",
    "",
    "{n, plural, one {{g, select, female {her file} other {their file}}} other {{n} files}}",
  );
  fireEvent.click(screen.getByRole("button", { name: "{n, plural}" }));
  expect(plain.value).toBe(
    "{n, plural, one {{g, select, female {} other {}}} other {#}}",
  );
  expect(screen.getByRole("button", { name: "{g, select}" })).toBeTruthy();
});

test("a nested skeleton goes one level deep, fills only the categories the source lacks, and keeps two inner arguments and exact keys (#765)", () => {
  // Each argument nested in the other, in different places.
  const crossed = pluralPane(
    "en",
    "",
    "{n, plural, one {{g, select, female {a} other {b}}} other {c}} {g, select, female {{n, plural, one {# x} other {# y}}} other {d}}",
  );
  fireEvent.click(screen.getByRole("button", { name: "{n, plural}" }));
  expect(crossed.value).toBe(
    "{n, plural, one {{g, select, female {} other {}}} other {#}}",
  );
  cleanup();
  // A select key with no nesting stays empty; the plural's `few` and
  // `many`, which the source lacks, hold what its `other` does.
  const sparse = pluralPane(
    "ru",
    "",
    "{g, select, female {her} other {{m, plural, one {#} other {#}}}} {n, plural, one {# x} other {{k, select, a {y} other {z}}}}",
  );
  fireEvent.click(screen.getByRole("button", { name: "{n, plural}" }));
  const select = "{k, select, a {} other {}}";
  expect(sparse.value).toBe(
    `{n, plural, one {#} few {${select}} many {${select}} other {${select}}}`,
  );
  cleanup();
  const plain = pluralPane(
    "ru",
    "",
    "{g, select, female {her} other {{m, plural, one {#} other {#}}}}",
  );
  fireEvent.click(screen.getByRole("button", { name: "{g, select}" }));
  expect(plain.value).toBe(
    "{g, select, female {} other {{m, plural, one {#} few {#} many {#} other {#}}}}",
  );
  cleanup();
  const two = pluralPane(
    "en",
    "",
    "{c, plural, =0 {none} other {{g, select, a {x} other {y}} {h, select, b {x} other {y}}}}",
  );
  fireEvent.click(screen.getByRole("button", { name: "{c, plural}" }));
  const inner = "{g, select, a {} other {}} {h, select, b {} other {}}";
  expect(two.value).toBe(`{c, plural, =0 {#} one {${inner}} other {${inner}}}`);
});

test("a select and a plural on one argument name each get their own chip and skeleton (#770)", () => {
  const source = "{n, plural, one {{n, select, a {x} other {y}}} other {z}}";
  const textarea = pluralPane("en", "", source);
  fireEvent.click(screen.getByRole("button", { name: "{n, plural}" }));
  expect(textarea.value).toBe(
    "{n, plural, one {{n, select, a {} other {}}} other {#}}",
  );
  cleanup();
  const select = pluralPane("en", "", source);
  fireEvent.click(screen.getByRole("button", { name: "{n, select}" }));
  expect(select.value).toBe("{n, select, a {} other {}}");
  // Filled as inserted, the plural's skeleton validates against the source.
  const filled = (skeleton: string) => skeleton.replaceAll("{}", "{x}");
  expect(validateTranslation(source, filled(textarea.value), "en")).toEqual({
    ok: true,
  });
  // Side by side, as released versions offered one chip that inserted
  // the select's keys into the plural.
  cleanup();
  const siblings =
    "{n, plural, one {# a} other {# b}} {n, select, a {x} other {y}}";
  const plural = pluralPane("en", "", siblings);
  fireEvent.click(screen.getByRole("button", { name: "{n, plural}" }));
  expect(plural.value).toBe("{n, plural, one {#} other {#}}");
  cleanup();
  const sibling = pluralPane("en", "", siblings);
  fireEvent.click(screen.getByRole("button", { name: "{n, select}" }));
  expect(sibling.value).toBe("{n, select, a {} other {}}");
  expect(
    validateTranslation(
      siblings,
      `${filled(plural.value)} ${filled(sibling.value)}`,
      "en",
    ),
  ).toEqual({ ok: true });
});

test("a suggestion shows above the draft, and its button fills the draft, validated as typed text; none, nothing shown (#774)", () => {
  render(
    <TargetPane
      action={vi.fn()}
      source={SOURCE}
      slots={slots}
      language="en"
      initialText=""
      slug="mm"
      stringKey="k"
      openedVersion={1}
      sourceLanguage="pt-PT"
      suggestion="{witness} saw {suspect}"
    />,
  );
  const region = screen.getByRole("region", {
    name: "The repository's unfinished text, not yet a translation",
  });
  expect(region.textContent).toContain("{witness} saw {suspect}");
  const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
  expect(textarea.value).toBe("");
  fireEvent.click(screen.getByRole("button", { name: "Use as draft" }));
  expect(textarea.value).toBe("{witness} saw {suspect}");
  expect(document.activeElement).toBe(textarea);
  // The guess drops {hour}: validation says so, as for typed text.
  expect(screen.getByText("Missing {hour}")).toBeTruthy();
  expect(
    (
      screen.getByRole("button", {
        name: "Save translation",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  cleanup();
  pane();
  expect(
    screen.queryByRole("region", {
      name: "The repository's unfinished text, not yet a translation",
    }),
  ).toBeNull();
});

test("a plural chip offers the branches the library's runtime picks: counterpart's English rule, easy_localization's by value (#951)", () => {
  for (const [syntax, language, fill, keys] of [
    ["counterpart", "pl", "%(count)s", ["one", "other"]],
    ["counterpart", "ja", "%(count)s", ["one", "other"]],
    ["easy_localization", "pl", "{}", ["one", "other"]],
    ["easy_localization", "ar", "{}", ["zero", "one", "two", "other"]],
    ["rails", "pl", "%{count}", ["one", "few", "many", "other"]],
  ] as const) {
    render(
      <TargetPane
        action={vi.fn()}
        source={`{count, plural, one {${fill} room} other {${fill} rooms}}`}
        syntax={syntax}
        slots={[]}
        language={language}
        initialText=""
        slug="mm"
        stringKey="k"
        openedVersion={1}
        examples={[]}
        sourceLanguage="en"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /\{count, plural\}/ }));
    expect(
      (screen.getByRole("textbox") as HTMLTextAreaElement).value,
      `${syntax} ${language}`,
    ).toBe(`{count, plural, ${keys.map((k) => `${k} {${fill}}`).join(" ")}}`);
    cleanup();
  }
});

test("a gettext file's Plural-Forms, where given, are the branches the chip offers and the draft needs (#951)", () => {
  render(
    <TargetPane
      action={vi.fn()}
      source="{count, plural, one {%d note} other {%d notes}}"
      syntax="printf"
      pluralForms={["one", "other"]}
      slots={[]}
      language="it"
      initialText=""
      slug="mm"
      stringKey="k"
      openedVersion={1}
      examples={[]}
      sourceLanguage="en"
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /\{count, plural\}/ }));
  const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
  expect(textarea.value).toBe("{count, plural, one {} other {}}");
  fireEvent.change(textarea, {
    target: { value: "{count, plural, one {%d nota} other {%d note}}" },
  });
  expect(screen.queryByText(/many branch/)).toBeNull();
});

test("a gettext file's own =N keys are branches the chip offers (#982)", () => {
  render(
    <TargetPane
      action={vi.fn()}
      source="{count, plural, one {%d file} other {%d files}}"
      syntax="printf"
      pluralForms={["=1", "other"]}
      slots={[]}
      language="ceb"
      initialText=""
      slug="mm"
      stringKey="k"
      openedVersion={1}
      examples={[]}
      sourceLanguage="en"
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /\{count, plural\}/ }));
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
    "{count, plural, =1 {} other {}}",
  );
});

test("a tag the source writes closed on itself is inserted so (#986)", () => {
  render(
    <TargetPane
      action={vi.fn()}
      source="Shared by <0/> today"
      syntax="i18next"
      slots={[]}
      language="fr"
      initialText=""
      slug="mm"
      stringKey="k"
      openedVersion={1}
      sourceLanguage="en"
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "<0>" }));
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
    "<0/>",
  );
});

test("an ordinal chip inserts a selectordinal with the language's ordinal keys (#995)", () => {
  render(
    <TargetPane
      action={vi.fn()}
      source="{age, selectordinal, one {#st} two {#nd} few {#rd} other {#th}} birthday"
      slots={[]}
      language="fr"
      initialText=""
      slug="mm"
      stringKey="k"
      openedVersion={1}
      sourceLanguage="en"
    />,
  );
  const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
  fireEvent.click(screen.getByRole("button", { name: "{age, selectordinal}" }));
  expect(textarea.value).toBe("{age, selectordinal, one {#} other {#}}");
});

test("under vue-i18n's default rule the editor says what each form is shown for, before any count goes wrong (#1018)", () => {
  const show = (pluralRules?: "default") =>
    render(
      <TargetPane
        action={vi.fn()}
        source="{n} minute | {n} minutes"
        syntax="vue"
        {...(pluralRules && { pluralRules })}
        slots={[]}
        language="pl"
        initialText=""
        slug="mm"
        stringKey="k"
        openedVersion={1}
        sourceLanguage="en"
      />,
    );
  show("default");
  expect(
    screen.getByText(
      "Under vue-i18n's default rule, write as many forms as the source, shown for =1 | other",
    ),
  ).toBeTruthy();
  cleanup();
  show();
  expect(screen.queryByText(/vue-i18n's default rule/)).toBeNull();
});

test("under gen_l10n a plural chip reads =1 as the one it stands for: the language's one, never both (#1039)", () => {
  render(
    <TargetPane
      action={vi.fn()}
      source="{count, plural, =1{One local change} other{{count} local changes}}"
      syntax="gen_l10n"
      slots={[]}
      language="hr"
      initialText=""
      slug="mm"
      stringKey="k"
      openedVersion={1}
      examples={[]}
      sourceLanguage="en"
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "{count, plural}" }));
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
    "{count, plural, one {{count}} few {{count}} other {{count}}}",
  );
});
