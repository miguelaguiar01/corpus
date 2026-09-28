// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { NoteText } from "./note-text";

afterEach(cleanup);

test("a note keeps its line breaks (#790)", () => {
  const { container } = render(
    <NoteText text={"The save button\nUsed in src/a.html:12"} />,
  );
  const note = container.querySelector("p")!;
  expect(note.textContent).toBe("The save button\nUsed in src/a.html:12");
  expect(note.className).toContain("whitespace-pre-line");
});
