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
  ).toEqual([[3, "photos left"]]);
});
