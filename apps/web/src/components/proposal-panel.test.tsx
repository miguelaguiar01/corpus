// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { ProposalPanel } from "./proposal-panel";

afterEach(cleanup);

const actions = { edit: vi.fn(), remove: vi.fn(), withdraw: vi.fn() };

function panel(overrides: Partial<Parameters<typeof ProposalPanel>[0]> = {}) {
  render(
    <ProposalPanel
      slug="mm"
      stringKey="ui.continue"
      source="Continuar {a}"
      slots={[{ name: "a", description: "A slot" }]}
      writable
      history={[]}
      actions={actions}
      {...overrides}
    />,
  );
}

test("idle offers a change and a removal; the change form opens prefilled with the source and its chips", () => {
  panel();
  expect(screen.getByRole("button", { name: "Propose removal" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Propose a change" }));
  const box = screen.getByLabelText(
    "Proposed source text",
  ) as HTMLTextAreaElement;
  expect(box.value).toBe("Continuar {a}");
  expect(screen.getByRole("button", { name: "{a}" })).toBeTruthy();
});

test("text equal to the source or failing the ICU parse disables the submit and names the error", () => {
  panel();
  fireEvent.click(screen.getByRole("button", { name: "Propose a change" }));
  const box = screen.getByLabelText("Proposed source text");
  const submit = screen.getByRole("button", {
    name: "Propose",
  }) as HTMLButtonElement;
  expect(submit.disabled).toBe(true);
  fireEvent.change(box, { target: { value: "Seguir {" } });
  expect(submit.disabled).toBe(true);
  expect(screen.getByText(/must parse as a source/)).toBeTruthy();
  fireEvent.change(box, { target: { value: "Seguir {a}" } });
  expect(submit.disabled).toBe(false);
});

test("a pending proposal shows its kind, text and author; withdraw only when allowed; the buttons stay", () => {
  panel({
    pending: {
      id: 7,
      kind: "edit",
      text: "Seguir",
      author: "rui",
      authorId: 2,
    },
  });
  expect(screen.getByText("Change")).toBeTruthy();
  expect(screen.getByText("Seguir")).toBeTruthy();
  expect(screen.getByText("proposed by rui")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Withdraw" })).toBeNull();
  expect(screen.getByRole("button", { name: "Propose a change" })).toBeTruthy();
  expect(screen.getByText(/newer proposal replaces/)).toBeTruthy();
  cleanup();
  panel({
    pending: {
      id: 7,
      kind: "edit",
      text: "Seguir",
      author: "rui",
      authorId: 2,
    },
    canWithdraw: true,
  });
  const form = screen
    .getByRole("button", { name: "Withdraw" })
    .closest("form")!;
  expect(
    (form.querySelector('input[name="proposalId"]') as HTMLInputElement).value,
  ).toBe("7");
  expect(
    (form.querySelector('input[name="key"]') as HTMLInputElement).value,
  ).toBe("ui.continue");
});

test("a string pull cannot write shows the note and no buttons", () => {
  panel({ writable: false });
  expect(screen.getByText(/cannot write back/)).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
});
