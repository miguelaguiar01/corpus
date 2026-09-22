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
  const source = `<template><p>Due {{ count }} days from now</p></template>`;
  expect(texts(source)).toEqual(["Due   days from now"]);
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
