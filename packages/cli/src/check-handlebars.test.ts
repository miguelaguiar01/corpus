import { expect, test } from "vitest";
import { findHandlebarsLiterals } from "./check-handlebars";

const found = (source: string) =>
  findHandlebarsLiterals(source, "row.hbs").map((f) => [f.line, f.text]);

test("a Handlebars template's text and static user-facing attributes are findings; Zulip's {{t}} and {{#tr}}, comments and expressions are not (#1027)", () => {
  const source = `<div class="x">Mark all as read {{t "Cancel"}}</div>
<button title="Close panel" aria-label="{{t 'Close'}}">{{~t "Done"~}}</button>
{{!-- A comment, not text --}}
{{! Neither is this }}
<p>{{#tr}}You have <b>{{count}}</b> unread messages{{/tr}}</p>
<p>{{~#tr~}}
    Visit <z-link>the help center</z-link>.
    {{#*inline "z-link"}}<a href="/help">{{> @partial-block}}</a>{{/inline}}
{{~/tr~}}</p>
{{#if open}}
  <span>Nothing here</span>
{{else}}
  <span title="Hello {{name}}">{{count}} topics muted</span>
{{/if}}
<input placeholder="{{placeholder}}" />
{{{rendered_markdown}}}
<script>const text = "Not markup";</script>
<style>p::after { content: "Not text"; }</style>
<pre>Sample output</pre>
`;
  expect(found(source)).toEqual([
    [1, "Mark all as read"],
    [2, "Close panel"],
    [11, "Nothing here"],
    [13, "Hello"],
    [13, "topics muted"],
  ]);
});

test("Handlebars: a finding's line is its text's own, past multi-line blocks and comments; corpus-ignore silences a line (#1027)", () => {
  const source = `{{!--
  several lines
--}}
{{#each items}}
  <li>
    {{name}}
    Unread
  </li>
{{/each}}
{{! corpus-ignore }}
<span>Silenced</span>
`;
  expect(found(source)).toEqual([[7, "Unread"]]);
});
