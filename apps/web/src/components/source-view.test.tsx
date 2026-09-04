// @vitest-environment jsdom
import { moonlightManor } from "@corpus/contract";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { SourceView } from "./source-view";

afterEach(cleanup);

const sighting = moonlightManor.strings[0]!;
const declarations = moonlightManor.stringTypes!["clue-skin"]!;
const slotsDecl = Object.values(declarations).find(
  (d) => d.type === "placeholders",
);
const slot = (name: string) =>
  slotsDecl?.type === "placeholders"
    ? (slotsDecl.slots as Record<string, { description: string }>)[name]!
        .description
    : "";

test("placeholders render as chips carrying the declared slot description", () => {
  render(<SourceView source={sighting.source} declarations={declarations} />);
  const person = screen.getByText("{person}");
  expect(person.getAttribute("title")).toContain(slot("person"));
  expect(screen.getByText("{hour}").getAttribute("title")).toContain(
    slot("hour"),
  );
});

test("each select renders as labelled branches instead of ICU syntax", () => {
  render(<SourceView source={sighting.source} declarations={declarations} />);
  const selects = screen.getAllByRole("group");
  expect(selects).toHaveLength(2);
  expect(selects[0]?.getAttribute("aria-label")).toBe("person_gender");
  expect(selects[0]?.textContent).toContain("m");
  expect(selects[0]?.textContent).toContain("visto");
  expect(selects[0]?.textContent).toContain("f");
  expect(selects[0]?.textContent).toContain("vista");
  expect(screen.queryByText(/select,/)).toBeNull();
});

test("literal text between segments is kept verbatim", () => {
  const { container } = render(
    <SourceView source={sighting.source} declarations={declarations} />,
  );
  expect(container.textContent).toContain(" foi ");
  expect(container.textContent).toContain(" à janela ");
});

test("a plain string is just text", () => {
  const { container } = render(
    <SourceView source="Continuar" declarations={{}} />,
  );
  expect(container.textContent).toBe("Continuar");
  expect(screen.queryAllByRole("group")).toHaveLength(0);
});

test("an undeclared placeholder still renders as a chip, without a tooltip", () => {
  render(<SourceView source="Olá {name}" declarations={{}} />);
  expect(screen.getByText("{name}").getAttribute("title")).toBeNull();
});
