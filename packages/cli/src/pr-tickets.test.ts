// bin/pr-tickets.mjs is what holds AGENTS.md's closing-keyword rule, so
// the rule's own trap is pinned here: the keyword binds to one number.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const check = (title: string, body: string, self = "999") =>
  spawnSync(
    "node",
    [fileURLToPath(new URL("../../../bin/pr-tickets.mjs", import.meta.url))],
    {
      env: { ...process.env, PR_TITLE: title, PR_BODY: body, PR_NUMBER: self },
      encoding: "utf8",
    },
  );

test("`Closes #A and #B` closes only #A, and is refused", () => {
  // What happened on #537, #536 and #533: the title named the tickets,
  // the body read as if it closed them, and they stayed open.
  const ran = check("Two things (#490, #491)", "Closes #490 and #491.");
  expect(ran.status).toBe(1);
  expect(ran.stderr).toContain("the title names #491");
  expect(ran.stderr).not.toContain("names #490");
});

test("a keyword per ticket passes", () => {
  expect(
    check("Two things (#490, #491)", "Closes #490. Closes #491.").status,
  ).toBe(0);
});

test("a ticket the PR deliberately leaves open is refs, not closes", () => {
  // #540 named #539 in its title and filed it rather than fixing it.
  expect(
    check("A gap is named (#539)", "Refs #539, filed by this PR.").status,
  ).toBe(0);
  expect(check("A gap is named (#539)", "This PR files #539.").status).toBe(1);
});

test("a title naming no ticket passes, and the PR's own number is not one", () => {
  expect(check("A README that says less", "").status).toBe(0);
  expect(check("A README that says less (#541)", "", "541").status).toBe(0);
});

test("a longer number is not the ticket", () => {
  const ran = check("One thing (#490)", "Closes #4901.");
  expect(ran.status).toBe(1);
  expect(ran.stderr).toContain("the title names #490");
});

test("a quoted keyword is a quotation, not a commitment", () => {
  // GitHub closes from the body it renders; a body that shows the rule
  // in a fence or a span, as several PRs here do, has not invoked it.
  const fenced = "Prose.\n\n```\nCloses #490\n```\n";
  expect(check("One (#490)", fenced).status).toBe(1);
  expect(check("One (#490)", "It says `Closes #490` on the page.").status).toBe(
    1,
  );
  expect(check("One (#490)", "> Closes #490").status).toBe(1);
  expect(check("One (#490)", "Closes #490.").status).toBe(0);
});

test("the other keywords, any case, and a keyword split over a line", () => {
  for (const word of [
    "Closes",
    "closes",
    "CLOSED",
    "Fixes",
    "fixed",
    "Resolves",
    "resolved",
    "Ref",
    "refs",
  ]) {
    expect(check("One (#490)", `${word} #490.`).status, word).toBe(0);
  }
  expect(check("One (#490)", "Closes\n#490.").status).toBe(0);
  expect(check("One (#490)", "Closing #490.").status).toBe(1);
});
