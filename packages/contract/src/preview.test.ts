import { expect, test } from "vitest";
import { moonlightManor } from "./fixtures/moonlight-manor";
import {
  exampleValues,
  previewsFor,
  renderPreview,
  renderPreviewSegments,
} from "./preview";

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

test("segments tell the example's values apart from the draft's words", () => {
  const draft = "{person} was seen at the {room_de} window.";
  const result = renderPreviewSegments(draft, first!.values);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.segments).toEqual([
    { text: "A Condessa Rosa", value: true },
    { text: " was seen at the ", value: false },
    { text: "da estufa", value: true },
    { text: " window.", value: false },
  ]);
  expect(result.segments.map((s) => s.text).join("")).toBe(
    renderPreview(draft, first!.values).ok
      ? (renderPreview(draft, first!.values) as { text: string }).text
      : "",
  );
});

test("an empty leading value still capitalises the sentence", () => {
  expect(renderPreview("{a}bcd", { a: "" })).toEqual({ ok: true, text: "Bcd" });
  expect(renderPreviewSegments("{a}bcd", { a: "" })).toEqual({
    ok: true,
    segments: [
      { text: "", value: true },
      { text: "Bcd", value: false },
    ],
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

test("the preview API is reachable from the package entry point", async () => {
  const entry = await import("./index");
  expect(typeof entry.renderPreview).toBe("function");
  expect(typeof entry.previewsFor).toBe("function");
});

test("exampleValues picks the target language's values and says so, or falls back to the source", () => {
  expect(exampleValues(first!, "en", "pt-PT")).toEqual({
    values: first!.valuesByLanguage!.en,
    language: "en",
  });
  expect(exampleValues(first!, "fr", "pt-PT")).toEqual({
    values: first!.values,
    language: "pt-PT",
  });
  expect(exampleValues({ values: { a: "b" } }, "en", "pt-PT")).toEqual({
    values: { a: "b" },
    language: "pt-PT",
  });
});

test("an English draft previews as the English sentence with English values", () => {
  const draft =
    "{person} was seen at the {room_de} window at {hour} — and was not alone.";
  expect(
    previewsFor(draft, sighting.examples!, { target: "en", source: "pt-PT" }),
  ).toEqual([
    {
      ok: true,
      text: "Countess Rosa was seen at the greenhouse window at 9 pm — and was not alone.",
    },
    {
      ok: true,
      text: "Doctor Vaz was seen at the drawing room window at 11 pm — and was not alone.",
    },
  ]);
  // Without a language, or for one the example lacks, the source values.
  expect(previewsFor(draft, sighting.examples!)[0]).toEqual({
    ok: true,
    text: "A Condessa Rosa was seen at the da estufa window at 21h — and was not alone.",
  });
});
