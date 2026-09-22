// Every ticket a pull request's title names must be answered in its body:
// `Closes #N` to close it on merge, or `Refs #N` to say deliberately that
// it stays open. AGENTS.md has asked for the closing keyword from the
// start; this is what checks it, because the keyword binds to one number
// — `Closes #490 and #491` closes only #490 — and #490, #491, #496, #499,
// #519 and #520 each sat open for a day after the work that closed them
// had merged. A PR template cannot catch it: `gh pr create --body` never
// reads one.
const title = process.env.PR_TITLE ?? "";
const body = process.env.PR_BODY ?? "";
const self = process.env.PR_NUMBER ?? "";

// The keyword has to be the body's own sentence, not a quotation of one:
// a fenced block, an inline span and a blockquote all read as somebody
// quoting the rule rather than invoking it — and this PR's own body
// quotes it twice. Erring this way costs a restated line; erring the
// other way passes a PR whose ticket then stays open, which is the whole
// thing being prevented.
const prose = body
  .replace(/```[\s\S]*?```/g, " ")
  .replace(/`[^`]*`/g, " ")
  .split("\n")
  .filter((line) => !/^\s*>/.test(line))
  .join("\n");

const answered = (n) =>
  new RegExp(
    `\\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|refs?)\\s+#${n}\\b`,
    "i",
  ).test(prose);

const named = [...title.matchAll(/#(\d+)/g)]
  .map((match) => match[1])
  .filter((n) => n !== self);
const unanswered = named.filter((n) => !answered(n));

if (unanswered.length > 0) {
  for (const n of unanswered) {
    console.error(
      `pr-tickets: the title names #${n}, and the body neither closes nor refs it`,
    );
    console.error(
      `pr-tickets: write \`Closes #${n}\` to close it on merge, or \`Refs #${n}\` to say it stays open`,
    );
  }
  console.error(
    "pr-tickets: one keyword per ticket — `Closes #1 and #2` closes only #1",
  );
  process.exit(1);
}
console.log(
  named.length > 0
    ? "pr-tickets: every ticket the title names is answered in the body"
    : "pr-tickets: the title names no ticket",
);
