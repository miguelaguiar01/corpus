// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { MetadataChips } from "./metadata-chips";

afterEach(cleanup);

const declarations = {
  kind: {
    type: "enum" as const,
    description: "What kind of clue",
    values: ["sighting", "alibi"],
  },
  requires_windows: { type: "flag" as const, description: "Needs windows" },
  note: { type: "text" as const, description: "Context" },
  slots: {
    type: "placeholders" as const,
    description: "Slots",
    slots: { person: { description: "Who was seen", role: "subject" } },
  },
  requires_trait: { type: "ref" as const, description: "Trait" },
};

test("renders enum values and true flags as chips with the description as tooltip", () => {
  render(
    <MetadataChips
      declarations={declarations}
      metadata={{ kind: "sighting", requires_windows: true }}
    />,
  );
  expect(
    screen.getByText("sighting").closest("[title]")?.getAttribute("title"),
  ).toBe("What kind of clue");
  expect(screen.getByTitle("Needs windows").textContent).toBe(
    "requires_windows",
  );
});

test("a false flag and an absent field render nothing", () => {
  render(
    <MetadataChips
      declarations={declarations}
      metadata={{ requires_windows: false }}
    />,
  );
  expect(screen.queryByText("requires_windows")).toBeNull();
  expect(screen.queryByText("sighting")).toBeNull();
});

test("text fields render as a note, not a chip", () => {
  render(
    <MetadataChips
      declarations={declarations}
      metadata={{ note: "Said by the butler; keep it dry." }}
    />,
  );
  const note = screen.getByText("Said by the butler; keep it dry.");
  expect(note.tagName).toBe("P");
});

test("placeholder declarations render nothing here even beside other chips; the source view shows them in context", () => {
  render(
    <MetadataChips declarations={declarations} metadata={{ kind: "alibi" }} />,
  );
  expect(screen.getByText("alibi")).toBeTruthy();
  expect(screen.queryByText("{person}")).toBeNull();
  expect(screen.queryByTitle("Who was seen")).toBeNull();
});

test("ref fields are left to the entity cards", () => {
  render(
    <MetadataChips
      declarations={declarations}
      metadata={{ requires_trait: "trait:insomnia" }}
    />,
  );
  expect(screen.queryByText("trait:insomnia")).toBeNull();
});
