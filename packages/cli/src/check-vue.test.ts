import { expect, test } from "vitest";
import { findVueLiterals } from "./check-vue";

const texts = (source: string) =>
  findVueLiterals(source, "A.vue").map((f) => f.text);

test("template text is a finding, an interpolation is not", () => {
  const source = `<template>
  <p>Stray text</p>
  <p>{{ t('a.b') }}</p>
  <img alt="Logo">
  <input :placeholder="hint">
  <i18n-t keypath="a.b">child</i18n-t>
</template>

<script setup lang="ts">
const hint = "not markup";
</script>
`;
  expect(texts(source)).toEqual(["Stray text", "Logo"]);
});

test("a bound or directive attribute is an expression, a static one is text", () => {
  const source = `<template>
  <BaseButton :aria-label="$t('a.b')" title="Close the dialog" />
  <span v-tooltip="$t('a.b')" label="Due date" />
  <a @click="go" placeholder="Search tasks">x</a>
</template>`;
  expect(texts(source)).toEqual([
    "Close the dialog",
    "Due date",
    "Search tasks",
  ]);
});

test("text around an interpolation is still text", () => {
  // The interpolation is blanked for the offset and collapsed for the
  // text, so the line is right and the finding still reads.
  const source = `<template><p>Due {{ count }} days from now</p></template>`;
  expect(texts(source)).toEqual(["Due   days from now"]);
});

test("a finding is on the line its text is on, not its tag's", () => {
  const source = `<template>
  <p
    class="a"
  >
    Stray text
  </p>
  <p>{{ x }}
    After an interpolation
  </p>
</template>`;
  expect(findVueLiterals(source, "A.vue").map((f) => f.line)).toEqual([5, 8]);
});

test("a template in a script comment or string does not become the block", () => {
  const trap = `<script setup lang="ts">
// <template><p>example</p></template>
const s = "</template>";
</script>

<template>
  <p>Real text</p>
</template>`;
  expect(texts(trap)).toEqual(["Real text"]);
});

test("a template in another language is not scanned as markup", () => {
  const pug = `<template lang="pug">
p Some pug source
</template>`;
  expect(texts(pug)).toEqual([]);
});

test("a comment, a style block and a script block carry no findings", () => {
  const source = `<template>
  <!-- A note to the reader -->
  <pre>literal block</pre>
  <p>Real text</p>
</template>
<style scoped>.a { content: "Not text"; }</style>`;
  expect(texts(source)).toEqual(["Real text"]);
});

test("a file with no template block yields nothing", () => {
  expect(texts(`<script setup>const a = "x";</script>`)).toEqual([]);
});

test("nested templates do not end the block early", () => {
  const source = `<template>
  <template v-if="a">
    <p>Inside</p>
  </template>
  <p>After</p>
</template>`;
  expect(texts(source)).toEqual(["Inside", "After"]);
});

test("corpus-ignore silences a template finding", () => {
  const source = `<template>
  <!-- corpus-ignore -->
  <p>Deliberate</p>
  <p>Not deliberate</p>
</template>`;
  expect(texts(source)).toEqual(["Not deliberate"]);
});

test("the block is found whatever precedes it, and only the real one", () => {
  const indented = `  <template>
    <p>Indented block</p>
  </template>`;
  expect(texts(indented)).toEqual(["Indented block"]);

  // A byte-order mark is not a tag.
  expect(texts(`\ufeff<template><p>After a mark</p></template>`)).toEqual([
    "After a mark",
  ]);

  // Script first, on one line.
  expect(
    texts(
      `<script setup>const a = 1;</script><template><p>Late</p></template>`,
    ),
  ).toEqual(["Late"]);

  // A comment on the same line as the block.
  expect(texts(`<!-- a note --><template><p>Noted</p></template>`)).toEqual([
    "Noted",
  ]);

  // A documentation block's example is not the component's template.
  const docs = `<docs>
\`\`\`vue
<template><p>example</p></template>
\`\`\`
</docs>

<template>
  <p>Real text</p>
</template>`;
  expect(texts(docs)).toEqual(["Real text"]);
});

test("lang=html is still markup, and a stray lang= elsewhere is not the block's", () => {
  expect(texts(`<template lang="html"><p>Still markup</p></template>`)).toEqual(
    ["Still markup"],
  );
  expect(texts(`<template xml:lang="en"><p>Not pug</p></template>`)).toEqual([
    "Not pug",
  ]);
});

test("a custom top-level block is raw text, as Vue reads it", () => {
  const preview = `<preview>
  <template><p>example</p></template>
</preview>

<template>
  <p>Real text</p>
</template>`;
  expect(texts(preview)).toEqual(["Real text"]);

  // A closing tag must end where the name does, or a string in the
  // script closes the block and the walk reads code as markup.
  const tricky = `<script setup>
const s = "</scriptx <template><p>trap</p></template>";
</script>

<template>
  <p>Still real</p>
</template>`;
  expect(texts(tricky)).toEqual(["Still real"]);
});
