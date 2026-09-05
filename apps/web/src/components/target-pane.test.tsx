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
  const preview = screen.getByRole("region", {
    name: "Preview with pt-PT values",
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
      language="en"
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
