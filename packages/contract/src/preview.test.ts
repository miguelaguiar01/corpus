import { expect, test } from "vitest";
import { moonlightManor } from "./fixtures/moonlight-manor";
import { previewsFor, renderPreview } from "./preview";

const sighting = moonlightManor.strings[0]!;
const [first, second] = sighting.examples!;

test("renders the fixture's examples exactly as the client rendered them", () => {
  expect(renderPreview(sighting.source, first!.values)).toEqual({
    ok: true,
    text: first!.rendered,
  });
  expect(renderPreview(sighting.source, second!.values)).toEqual({
    ok: true,
    text: second!.rendered,
  });
});

test("previewsFor renders one preview per example, in order", () => {
  expect(previewsFor(sighting.source, sighting.examples!)).toEqual([
    { ok: true, text: first!.rendered },
    { ok: true, text: second!.rendered },
  ]);
});

test("a draft with a collapsed select renders with the example values", () => {
  const draft =
    "{person} was seen at the {room_de} window at {hour} — and was not alone.";
  expect(renderPreview(draft, first!.values)).toEqual({
    ok: true,
    text: "A Condessa Rosa was seen at the da estufa window at 21h — and was not alone.",
  });
});

test("a leading slot value is capitalised; a leading literal is left alone", () => {
  expect(renderPreview("{who} saw it", { who: "o mordomo" })).toEqual({
    ok: true,
    text: "O mordomo saw it",
  });
  expect(renderPreview("by {who}", { who: "o mordomo" })).toEqual({
    ok: true,
    text: "by o mordomo",
  });
});

test("a missing value leaves the slot literally in the text", () => {
  expect(renderPreview("Seen at {hour} by {who}", { hour: "21h" })).toEqual({
    ok: true,
    text: "Seen at 21h by {who}",
  });
});

test("a select value with no matching branch falls back to `other`, then the first branch", () => {
  expect(renderPreview("{g, select, m {he} other {they}}", { g: "x" })).toEqual(
    { ok: true, text: "they" },
  );
  expect(renderPreview("{g, select, m {he} f {she}}", { g: "x" })).toEqual({
    ok: true,
    text: "he",
  });
  expect(renderPreview("{g, select, m {he} f {she}}", {})).toEqual({
    ok: true,
    text: "he",
  });
});

test("a malformed message is a typed error, never a throw", () => {
  const result = renderPreview("{person} foi {g, select, m {visto}", {});
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors[0]).toMatchObject({ position: expect.any(Number) });
  }
});

test("no examples means no previews", () => {
  expect(previewsFor("Continuar", [])).toEqual([]);
});
