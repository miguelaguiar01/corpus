// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { EntityCards } from "./entity-cards";

afterEach(cleanup);

const cards = [
  {
    field: "requires_trait",
    entityId: "trait:insomnia",
    type: "trait",
    typeLabel: "Trait",
    name: "Insónia",
    attributes: { summary: "Wanders the manor at night." },
  },
  {
    field: "mentions",
    entityId: "character:doutor-vaz",
    type: "character",
    typeLabel: "Character",
    name: "Doutor Vaz",
    attributes: null,
  },
];

test("renders a card per entity with its type label, name, and attributes", () => {
  render(<EntityCards entities={cards} />);
  expect(screen.getByText("Insónia")).toBeTruthy();
  expect(screen.getByText("Trait")).toBeTruthy();
  expect(screen.getByText("summary")).toBeTruthy();
  expect(screen.getByText("Wanders the manor at night.")).toBeTruthy();
  expect(screen.getByText("Doutor Vaz")).toBeTruthy();
  expect(screen.getByText("Character")).toBeTruthy();
});

test("renders nothing when there are no entities", () => {
  const { container } = render(<EntityCards entities={[]} />);
  expect(container.innerHTML).toBe("");
});
