import { expect, test } from "vitest";
import { decodeEntities } from "./text";

test("XML's five named entities and character references decode; any other name stays as written, a property of Object's included (#818)", () => {
  expect(decodeEntities("&lt;&gt;&amp;&quot;&apos;&#65;&#x42;")).toBe(
    "<>&\"'AB",
  );
  expect(decodeEntities("Tom &constructor; &toString; &nbsp; &#x110000;")).toBe(
    "Tom &constructor; &toString; &nbsp; &#x110000;",
  );
});
