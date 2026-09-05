// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { ProgressByType } from "./progress-by-type";

afterEach(cleanup);

const counts = (verified: number, translated: number, total: number) => ({
  verified,
  translated,
  untranslated: total - verified - translated,
  stale: 0,
  total,
});

const progress = {
  perLanguage: { "pt-PT": counts(1, 2, 3), en: counts(0, 0, 3) },
  perType: {
    "clue-skin": { "pt-PT": counts(1, 1, 2), en: counts(0, 0, 2) },
    chrome: { "pt-PT": counts(0, 1, 1), en: counts(0, 0, 1) },
  },
};

test("renders a section per language with its summary", () => {
  render(<ProgressByType progress={progress} />);
  expect(screen.getByRole("heading", { name: "pt-PT" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "en" })).toBeTruthy();
  expect(screen.getByText("1 verified, 2 translated of 3")).toBeTruthy();
});

test("renders a labelled bar per string type under each language", () => {
  render(<ProgressByType progress={progress} />);
  const bars = screen.getAllByRole("meter");
  expect(bars).toHaveLength(4);
  const skin = screen.getAllByRole("meter", { name: "clue-skin" });
  expect(skin[0]?.getAttribute("aria-valuenow")).toBe("2");
  expect(skin[0]?.getAttribute("aria-valuemax")).toBe("2");
});

test("names the three fills once, in a legend", () => {
  render(<ProgressByType progress={progress} />);
  const legend = screen.getByRole("list", { name: "Fills" });
  expect(legend.textContent).toBe("VerifiedTranslatedUntranslated");
});

test("renders nothing for a project with no rows", () => {
  const { container } = render(
    <ProgressByType progress={{ perLanguage: {}, perType: {} }} />,
  );
  expect(container.innerHTML).toBe("");
});
