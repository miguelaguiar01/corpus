// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { moonlightManor } from "@corpus/contract";
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
