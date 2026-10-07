import { expect, test } from "vitest";
import { findSvelteLiterals } from "./check-svelte";

const found = (source: string) =>
  findSvelteLiterals(source, "A.svelte").map((f) => [f.line, f.text]);

test("a Svelte component's text nodes and static user-facing attributes are findings; expressions, blocks and directives are not (#1025)", () => {
  const source = `<script lang="ts">
  import { t } from "$lib/i18n";
  const label = "Not markup";
  const greater = (a: number, b: number) => a > b;
</script>

<button title="Delete album" on:click={() => greater(1, 2) && remove()}>Delete all photos</button>
<p>{$t('album.empty')}</p>
<input bind:value={name} placeholder={$t('search')} aria-label="Search albums" />
{#if open}
  <span>{$_('x')}</span>
{:else}
  <span>Nothing here</span>
{/if}
{@html $t('rich')}
<p title="Hello {name}">{count} photos selected</p>
<style>
  p::after { content: "Not text"; }
</style>
`;
  expect(found(source)).toEqual([
    [7, "Delete album"],
    [7, "Delete all photos"],
    [9, "Search albums"],
    [13, "Nothing here"],
    [16, "Hello"],
    [16, "photos selected"],
  ]);
});

test("Svelte: comments, pre and code are not text; corpus-ignore silences a line (#1025)", () => {
  const source = `<!-- A comment, not text -->
<pre>Sample output</pre>
<code>npm run build</code>
<!-- corpus-ignore -->
<p>Silenced line</p>
<p>A real sentence</p>
`;
  expect(found(source)).toEqual([[6, "A real sentence"]]);
});

test("an expression divides the text around it, as JSX's does: units between values are not words (#1025)", () => {
  expect(
    found(
      "<p>{percent}% - {speed}/s - {remaining}s</p>\n<p>(HTTP {status})</p>\n<p>{n} photos left</p>\n",
    ),
  ).toEqual([
    [2, "(HTTP"],
    [3, "photos left"],
  ]);
});

test("a finding names the line its text starts on, indented or after an expression; an escaped quote or a brace in a comment hides nothing (#1025)", () => {
  expect(found("<button>\n        Save\n</button>\n")).toEqual([[2, "Save"]]);
  expect(found("<p>\n  {count}\n  MP\n</p>\n")).toEqual([[3, "MP"]]);
  expect(found("<p>{'it\\'s'}</p>\n<p>Not lost</p>\n")).toEqual([
    [2, "Not lost"],
  ]);
  expect(found("<!-- do not use { here -->\n<p>Not lost</p>\n")).toEqual([
    [2, "Not lost"],
  ]);
  // A comment opener in a script string opens nothing; a quote in an
  // expression's comment ends no string.
  expect(
    found(
      '<script>\n  const open = "<!--";\n</script>\n<p>Not lost</p>\n<!-- a note -->\n<p>Also kept</p>\n',
    ),
  ).toEqual([
    [4, "Not lost"],
    [6, "Also kept"],
  ]);
  expect(found("<p>{x /* don't */}</p>\n<p>Not lost</p>\n")).toEqual([
    [2, "Not lost"],
  ]);
  // A component named Script is markup, not a script block.
  expect(found("<Script>\n  Shown text\n</Script>\n")).toEqual([
    [2, "Shown text"],
  ]);
});

test("Svelte: a regex literal with a quote, /* or a slash in a class is one expression; division stays division (#1140)", () => {
  for (const expression of [
    "{x.match(/'/)}",
    "{x.match(/a\\/*b/)}",
    "{x.match(/[/]'/)}",
    "{#if /'/.test(x)}<b>A</b>{/if}",
    "{#if a}{:else if /'/.test(x)}{/if}",
    "{@html x.replace(/'/g, '')}",
    // An attribute's value is no block: it may start with a regex.
    "<b title={/'/.source}>x</b>",
    "{x.replace(/\"/g, '')}",
    "{ok ? /'/ : /\"/}",
    "{typeof /'/}",
  ])
    expect(found(`${expression}\n<p>Hello world</p>`), expression).toEqual([
      [2, "Hello world"],
    ]);
  for (const expression of [
    "{a / b / c}",
    "{x / 2}",
    "{(a) / b}",
    "{'https://x.org/a'}",
    "{a[1] / b}",
    "{i++ / 2}",
    "{a.return / 2}",
  ])
    expect(found(`${expression}\n<p>Hello world</p>`), expression).toEqual([
      [2, "Hello world"],
    ]);
  // A block closes with `{/`: `{/if}</div>` opens no regex, as Immich's
  // `{/if}</Button` does not.
  for (const [open, close] of [
    ["{#if a}", "{/if}</div>"],
    ["{#each a as b}", "{/each}</ul>"],
    ["{#if a}", '{/if} <a href="/home">x</a>'],
    ["{#key a}", "{/key}<i>x</i>"],
    // A text's `=` before a closer is no attribute.
    ["{#if eq}", "={/if}</span>"],
    ["<p>x {#if a}", " ={/if}</p>"],
  ])
    expect(
      found(`${open}<b>A</b>${close}\n<p>Hello world</p>`),
      close,
    ).toContainEqual([2, "Hello world"]);
  // TypeScript's non-null assertion, Immich's `{asset.duration! / 1000}`,
  // divides as the value without it does.
  const line =
    "{asset.duration! / 1000} <i>of</i> {total / 2}\n<p>Hello world</p>";
  expect(found(line)).toEqual(found(line.replace("!", "")));
  expect(found(line)).toContainEqual([2, "Hello world"]);
});
