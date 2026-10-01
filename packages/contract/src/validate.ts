// Translation validation rules (§5, §7, §15), pure and shared by the
// editor and the server: the target must parse under the ICU subset;
// every source placeholder must survive and none may be added; a target
// may collapse a select into plain text, but any select it keeps must be
// on an argument the source selects on, with the same branch keys. A
// count the source prints is a value like a placeholder: it must
// survive, as `{n}` or as a plural on n (one it only selects on may be
// written as one text, #992), and a target may pluralise any
// value the source has; with the target language given, a plural's
// categories must be the ones its runtime picks in that language. A
// rich-text tag is a component the client renders: every tag in the
// source must occur in the target and none may be added, wherever it
// moves, unless the string's type is read as HTML (`richText: "html"`),
// where a tag is markup the translation may write its own way.
// Errors are data (code + params); callers render them through their
// own message catalog.
import {
  argPositions,
  branchingNodes,
  parseIcu,
  readIcu,
  printfPluralError,
  WHOLE_PLURAL_LIBRARIES,
  pluralCategoriesFor,
  pluralCategoriesOf,
  pluralCategoryCovered,
  printfVerbOf,
  proseTagsOf,
  isHtmlElement,
  type ProseTag,
  type IcuNode,
  type Shape,
  shapeOf,
} from "./icu";
import {
  EXACT_KEY,
  PLURAL_CATEGORIES,
  readsAsIcu,
  type Library,
  type RichText,
} from "./strings";

export type ValidationError =
  | {
      code: "invalid-icu";
      where: "source" | "target";
      message: string;
      position: number;
    }
  // `written` is the placeholder as the source or the target writes it
  // when that is not `{name}` (printf's `%s`), for the message.
  | { code: "missing-placeholder"; name: string; written?: string }
  | { code: "unexpected-placeholder"; name: string; written?: string }
  | { code: "unknown-select"; arg: string }
  | { code: "missing-branch"; arg: string; key: string }
  | { code: "unexpected-branch"; arg: string; key: string }
  | { code: "unknown-plural"; arg: string }
  // A plural whose count the source never prints, written as one text:
  // no value is lost, but a language that inflects reads one form for
  // every count (#992).
  | { code: "flattened-plural"; arg: string }
  // Qt: a numerus translation that prints `%n` where the source prints
  // the same count through `.arg()`'s `%1` (#1003).
  | { code: "count-for-marker"; name: string; written?: string }
  // A cardinal plural where the source has a selectordinal, or the
  // reverse (`ordinal` is the source's): the other rule picks (#995).
  | { code: "changed-ordinal"; arg: string; ordinal: boolean }
  // A Fluent translation's select or plural on a variable its source
  // never has: Fluent renders the default (#1032).
  | { code: "unpassed-selector"; arg: string }
  // A select and plural nested as the source does not nest them (#764).
  | { code: "changed-nesting"; outer: string; inner: string }
  // `#` in a select within a plural, text to FormatJS and ICU and the
  // count to messageformat.js: `{arg}` reads the same to all.
  | { code: "nested-count"; arg: string }
  | { code: "missing-category"; arg: string; key: string }
  | { code: "unexpected-category"; arg: string; key: string }
  // A formatted placeholder written with another type, or with none
  // (`actual: null`); the style is the translator's (#555).
  | {
      code: "unexpected-format";
      name: string;
      expected: string;
      actual: string | null;
    }
  | { code: "missing-tag"; name: string }
  // The source's pair written closed on itself, `<2/>` for `<2>…</2>`,
  // which wraps nothing (#986).
  | { code: "unpaired-tag"; name: string }
  | { code: "unexpected-tag"; name: string }
  // printf (#594): the verb at a position prints another type than the
  // source's (`%s` where the source has `%d`), which is what a verb
  // moved without an index looks like, since unindexed verbs are named
  // by their order; `indexed` is the index form in the source's style
  // (#645), and `moved` says whether the verb is one the source writes
  // elsewhere or a type it does not have.
  | {
      code: "changed-verb";
      name: string;
      expected: string;
      actual: string;
      indexed: string;
      // Whether the translation's verb is one the source writes at
      // another position (a verb that moved), or a type the source
      // does not have (#645).
      moved: boolean;
    };

// A plural missing a category the runtime picks is incomplete rather
// than invalid (#556): ICU falls back to `other`, and a many-language
// catalogue ships that way. It rides beside the result, apart, and an
// editor warns where it would have refused.
export type ValidationResult =
  | { ok: true; incomplete?: ValidationError[] }
  | { ok: false; errors: ValidationError[]; incomplete?: ValidationError[] };

// Each select or plural inside another's branch, as `outer inner`.
function nestingOf(
  nodes: IcuNode[],
  outer?: string,
  out = new Set<string>(),
): Set<string> {
  for (const node of nodes) {
    if (node.kind === "select" || node.kind === "plural") {
      if (outer !== undefined) out.add(`${outer} ${node.arg}`);
      for (const branch of Object.values(node.branches))
        nestingOf(branch, node.arg, out);
    } else if (node.kind === "tag") nestingOf(node.children, outer, out);
  }
  return out;
}

// The plurals whose count a `#` in a select within them was meant for.
function countsInSelects(
  nodes: IcuNode[],
  within: { plural?: string; select?: boolean } = {},
  out = new Set<string>(),
): Set<string> {
  for (const node of nodes) {
    if (node.kind === "literal" && within.select && within.plural)
      if (node.text.includes("#")) out.add(within.plural);
    if (node.kind === "select" || node.kind === "plural")
      for (const branch of Object.values(node.branches))
        countsInSelects(
          branch,
          node.kind === "plural"
            ? { plural: node.arg }
            : { plural: within.plural, select: true },
          out,
        );
    if (node.kind === "tag") countsInSelects(node.children, within, out);
  }
  return out;
}

// The plurals whose `#` a source writes in a select within them, which
// runtimes read two ways (#767): said to the author, never refused.
export function nestedCountsOf(
  source: string,
  syntax: Library = "icu",
): string[] {
  const parsed = readIcu(source, syntax);
  return parsed.ok ? [...countsInSelects(parsed.nodes)] : [];
}

// A language tag's base language, case and region aside: en for en-GB.
function baseOf(tag: string): string {
  return tag.split(/[-_]/)[0]!.toLowerCase();
}

// The markers Qt fills in a translation (#1003): `QString::arg` replaces
// as many as the source has, lowest-numbered first, so a higher one is
// text (Turkish `%10` for 10%); and in a numerus message translate()
// fills every `%n`.
function qtFilled(target: Shape, source: Shape): Shape {
  // `%1` to `%99`: a `%0` is no marker .arg() ranks, kept to be named.
  const numbered = (shape: Shape) =>
    [...shape.placeholders].filter((n) => /^\d+$/.test(n) && n !== "0");
  const k = numbered(source).length;
  const filled = new Set(
    numbered(target)
      .sort((a, b) => Number(a) - Number(b))
      .slice(0, k),
  );
  const placeholders = new Set(
    [...target.placeholders].filter(
      (n) => !/^\d+$/.test(n) || n === "0" || filled.has(n),
    ),
  );
  return { ...target, placeholders };
}

// What a text prints: its placeholders and the counts its plurals'
// branches write as `#`, through tags, branches and forms.
function printedIn(nodes: IcuNode[], out = new Set<string>()): Set<string> {
  for (const node of nodes) {
    if (node.kind === "placeholder") out.add(node.name);
    else if (node.kind === "count") out.add(node.arg);
    else if (node.kind === "tag") printedIn(node.children, out);
    else if (node.kind === "select" || node.kind === "plural")
      for (const branch of Object.values(node.branches)) printedIn(branch, out);
    else if (node.kind === "forms")
      for (const branch of node.branches) printedIn(branch, out);
  }
  return out;
}

// The values a message uses: its placeholders and the counts it
// pluralises on. A select's argument is not one; it picks a branch.
function valuesOf(shape: Shape): Set<string> {
  return new Set([...shape.placeholders, ...shape.plurals.keys()]);
}

// The nodes with each plural's branches narrowed to those `keep` names.
function pickedBranches(
  nodes: IcuNode[],
  keep: (key: string, ordinal: boolean) => boolean,
): IcuNode[] {
  return nodes.map((node): IcuNode => {
    if (node.kind === "plural")
      return {
        ...node,
        branches: Object.fromEntries(
          Object.entries(node.branches)
            .filter(([key]) => keep(key, node.ordinal === true))
            .map(([key, branch]) => [key, pickedBranches(branch, keep)]),
        ),
      };
    if (node.kind === "select")
      return {
        ...node,
        branches: Object.fromEntries(
          Object.entries(node.branches).map(([key, branch]) => [
            key,
            pickedBranches(branch, keep),
          ]),
        ),
      };
    if (node.kind === "tag")
      return { ...node, children: pickedBranches(node.children, keep) };
    return node;
  });
}

// The message as an other-only language renders it: each plural on
// `args` replaced by its `other` branch, `#` by the count.
// A plural by its kind and argument: `ordinal n`, `cardinal n` (#995).
function pluralId(ordinal: boolean, arg: string): string {
  return `${ordinal ? "ordinal" : "cardinal"} ${arg}`;
}

function otherBranch(nodes: IcuNode[], args: Set<string>): IcuNode[] {
  return nodes.flatMap((node): IcuNode[] => {
    if (
      node.kind === "plural" &&
      args.has(pluralId(node.ordinal === true, node.arg))
    )
      return otherBranch(node.branches.other ?? [], args);
    if (
      node.kind === "count" &&
      (args.has(pluralId(false, node.arg)) ||
        args.has(pluralId(true, node.arg)))
    )
      return [{ kind: "placeholder", name: node.arg }];
    if (node.kind === "select" || node.kind === "plural")
      return [
        {
          ...node,
          branches: Object.fromEntries(
            Object.entries(node.branches).map(([key, branch]) => [
              key,
              otherBranch(branch, args),
            ]),
          ),
        },
      ];
    if (node.kind === "tag")
      return [{ ...node, children: otherBranch(node.children, args) }];
    if (node.kind === "forms")
      return [
        { ...node, branches: node.branches.map((b) => otherBranch(b, args)) },
      ];
    return [node];
  });
}

// Where `<br>` and the other void elements open nothing (#643): a type
// read as HTML, an Android string (rendered through fromHtml), and
// i18next, whose react-i18next Trans keeps them void.
export function hasVoidTags(syntax: Library, richText?: TextReading): boolean {
  return isHtml(richText) || syntax === "android" || syntax === "i18next";
}

// How a string's text is read: its type's `richText` (#622), or, for a
// Rails key ending `_html` or `.html`, which Rails marks html_safe
// whatever the type, "html-key", its type's `richText` too: HTML whose
// tags a translation writes its own way, but closes, as the source does
// (#988).
export type TextReading = RichText | "html-key";

export function isHtml(reading: TextReading | undefined): boolean {
  return reading === "html" || reading === "html-key";
}

export function richTextFor(
  type: string,
  id: string,
  library: Library,
  richText: Readonly<Record<string, RichText>> | null | undefined,
): TextReading | undefined {
  // Rails' own test, `html_safe_translation_key?`, on the whole key.
  if (library === "rails" && /(?:_|\b)html$/.test(id)) return "html-key";
  return richText?.[type] ?? undefined;
}

// How a type's text reads its tags: "markup" for a type read as HTML,
// where a tag that never closes is text, as a browser reads it (#755),
// and under i18next, whose `t()` text React escapes and whose `Trans`
// renders only a tag that closes (#986), and Android's, whose unpaired
// tag can only be an escape or CDATA's text, well-formed XML closing
// every element (#987), their tags still compared; else whether void
// elements open nothing.
export function tagMode(
  syntax: Library,
  richText?: TextReading,
): boolean | "markup" {
  return isHtml(richText) || syntax === "i18next" || syntax === "android"
    ? "markup"
    : hasVoidTags(syntax, richText);
}

// The libraries whose placeholders are written verbs (`%s`, `%(n)s`,
// `%{n}`, `%1`, `{}`): a value missing with no verb written is a plural's
// count, the translation having dropped the plural (#652).
const VERB_LIBRARIES: ReadonlySet<Library> = new Set([
  "printf",
  "android",
  "counterpart",
  "easy_localization",
  "rails",
  "qt",
]);

export function isDroppedPlural(
  error: ValidationError,
  syntax: Library,
): boolean {
  return (
    error.code === "missing-placeholder" &&
    error.written === undefined &&
    VERB_LIBRARIES.has(syntax)
  );
}

export function validateTranslation(
  source: string,
  target: string,
  language?: string,
  syntax: Library = "icu",
  // `arguments`: the verbs the code passes, by position, where a key
  // carries them (a String Catalog's `%lld`, #731): values a translation
  // may pluralise on or print, of their type, though the source text
  // prints none of them.
  // `pluralForms`: the categories the runtime picks where they are not
  // the language's CLDR ones: a gettext file's `Plural-Forms`' (#951),
  // rails-i18n's (#983).
  // `term`: the string is a Fluent term, whose variables are what its
  // callers pass, so a select on one is never unpassed (#1032).
  options: {
    richText?: TextReading;
    arguments?: string[];
    pluralForms?: readonly string[];
    term?: boolean;
    // The source's language: a target of the same base language, en-GB
    // for en, takes the source's own plural categories (#1005).
    sourceLanguage?: string;
  } = {},
): ValidationResult {
  const html = tagMode(syntax, options.richText);
  const parsedSource = parseIcu(source, syntax, { html });
  if (!parsedSource.ok) {
    return {
      ok: false,
      errors: parsedSource.errors.map((e) => ({
        code: "invalid-icu",
        where: "source",
        ...e,
      })),
    };
  }
  // A translation of a printf plural that opens as one but is not one
  // is a broken plural, not text (#652), whatever reading it as text
  // then trips on (#950).
  const brokenPlural =
    WHOLE_PLURAL_LIBRARIES.has(syntax) &&
    parsedSource.nodes.some((node) => node.kind === "plural")
      ? printfPluralError(target, html, syntax)
      : undefined;
  if (brokenPlural)
    return {
      ok: false,
      errors: [{ code: "invalid-icu", where: "target", ...brokenPlural }],
    };
  const parsedTarget = parseIcu(target, syntax, { html });
  if (!parsedTarget.ok) {
    return {
      ok: false,
      errors: parsedTarget.errors.map((e) => ({
        code: "invalid-icu",
        where: "target",
        ...e,
      })),
    };
  }
  const positioned = (nodes: IcuNode[]) =>
    syntax === "printf" ? argPositions(nodes) : nodes;
  const sourceNodes = positioned(parsedSource.nodes);
  const targetNodes = positioned(parsedTarget.nodes);
  const whole = shapeOf(sourceNodes);
  const actual =
    syntax === "qt"
      ? qtFilled(shapeOf(targetNodes), whole)
      : shapeOf(targetNodes);
  // A lookalike percent before a marker is text Qt prints (#1003).
  if (syntax === "qt") {
    const mangled = /([٪％])(L?(?:\d|n))/.exec(target);
    if (mangled)
      return {
        ok: false,
        errors: [
          {
            code: "invalid-icu",
            where: "target",
            message: `writes ${mangled[0]}, which Qt prints as text; write %${mangled[2]}`,
            position: mangled.index,
          },
        ],
      };
  }
  // A language whose only category is `other` renders a plural as its
  // `other` branch, so a translation may write that text plainly (#651);
  // not on Android, where a <string> is another resource than the
  // <plurals> the code asks for.
  const categories = language === undefined ? [] : pluralCategoriesOf(language);
  // A selectordinal's are its language's ordinal ones (#995): German's
  // is `other` alone. A cardinal and an ordinal on one argument are each
  // their own plural, flattened by its own rule.
  const categoriesOf = (ordinal: boolean) =>
    language === undefined
      ? []
      : ordinal
        ? pluralCategoriesOf(language, true)
        : categories;
  const kinds = (shape: Shape) =>
    [
      [false, shape.cardinalPlurals],
      [true, shape.ordinalPlurals],
    ] as const;
  const flat = new Set<string>();
  for (const [ordinal, map] of kinds(whole))
    for (const arg of map.keys()) {
      const mine = ordinal ? actual.ordinalPlurals : actual.cardinalPlurals;
      // The other kind there is a changed one unless the source has it.
      const swapped =
        (ordinal ? actual.cardinalPlurals : actual.ordinalPlurals).has(arg) &&
        !(ordinal ? whole.cardinalPlurals : whole.ordinalPlurals).has(arg);
      if (!mine.has(arg) && !swapped && categoriesOf(ordinal).length === 1)
        flat.add(pluralId(ordinal, arg));
    }
  const flattened =
    flat.size > 0 && syntax !== "android"
      ? otherBranch(sourceNodes, flat)
      : sourceNodes;
  const expected = flattened === sourceNodes ? whole : shapeOf(flattened);
  let errors: ValidationError[] = [];
  const expectedValues = valuesOf(expected);
  const sameBase =
    options.sourceLanguage !== undefined &&
    language !== undefined &&
    baseOf(language) === baseOf(options.sourceLanguage);
  // A plural written plainly may still print its count, which the
  // runtime passes (#1005): Immich's yue `永久刪除 {count} 個項目`.
  // Qt's numerus message fills `%n` in every branch (#1003).
  const numerus = syntax === "qt" && whole.plurals.size > 0;
  const allowedValues = new Set([
    ...expectedValues,
    ...[...flat].map((id) => id.slice(id.indexOf(" ") + 1)),
    ...(numerus ? ["n"] : []),
  ]);
  const actualValues = valuesOf(actual);

  const writtenAs = (shape: Shape, name: string) => {
    const written = shape.written.get(name);
    return written ? { written } : {};
  };
  // A value only a source branch the runtime never picks prints is not
  // missed: English's `one {Delete "{{name}}"?}` in Japanese, whose
  // i18next plural shows `other` (#985). The branches kept are `other`,
  // every `=N` and the categories the library's rule may pick, so
  // counterpart's Japanese `one` still needs its values.
  // A tag with no plural data is checked for its shape alone, every
  // branch's values needed: its runtime falls back to another locale's
  // rule; counterpart's English rule holds for every tag.
  const picks =
    language === undefined ||
    (categories.length === 0 && syntax !== "counterpart")
      ? []
      : pluralCategoriesFor(language, syntax, options.pluralForms).allowed;
  const ordinalPicks =
    language === undefined
      ? []
      : pluralCategoriesFor(language, syntax, undefined, true).allowed;
  const required =
    picks.length > 0
      ? valuesOf(
          shapeOf(
            pickedBranches(
              flattened,
              (key, ordinal) =>
                key === "other" ||
                key.startsWith("=") ||
                (ordinal ? ordinalPicks : picks).includes(key),
            ),
          ),
        )
      : expectedValues;
  // In ICU a plural on a count the source never prints is a selector,
  // as a select's argument is: a translation that writes it as one text
  // misses no value; it is incomplete wherever the language may have
  // forms to tell apart, every language but one of a single category, a
  // tag with no plural data checked for its shape (#992). A `#` in a
  // select within the plural counts as printed, as messageformat.js
  // prints it. Elsewhere a plural is what
  // the writer holds as one (a key family, a Rails hash, gettext's
  // msgid_plural, Android's <plurals>), which one text cannot fill.
  const sourcePrints = printedIn(sourceNodes);
  for (const arg of countsInSelects(sourceNodes)) sourcePrints.add(arg);
  for (const name of required) {
    if (actualValues.has(name)) continue;
    // `%n` shows the count a dropped `%1` would have (#1003).
    if (numerus && /^\d+$/.test(name) && actual.placeholders.has("n")) {
      errors.push({
        code: "count-for-marker",
        name,
        ...writtenAs(expected, name),
      });
      continue;
    }
    if (
      readsAsIcu(syntax) &&
      expected.plurals.has(name) &&
      !sourcePrints.has(name)
    ) {
      // A source plural of `other` alone varies by nothing in a language
      // of its base, so a plain copy flattens nothing (#1005).
      const otherOnly = [...(whole.plurals.get(name) ?? [])].every(
        (k) => k === "other",
      );
      const ordinalOnly =
        whole.ordinalPlurals.has(name) && !whole.cardinalPlurals.has(name);
      if (categoriesOf(ordinalOnly).length !== 1 && !(sameBase && otherOnly))
        errors.push({ code: "flattened-plural", arg: name });
      continue;
    }
    errors.push({
      code: "missing-placeholder",
      name,
      ...writtenAs(expected, name),
    });
  }
  // Outside ICU, whose `#` prints it, a plural on a value prints nothing:
  // a count the source writes is shown only where a form writes it too
  // (#949).
  if (!readsAsIcu(syntax))
    for (const name of expected.placeholders)
      if (!actual.placeholders.has(name) && actualValues.has(name))
        errors.push({
          code: "missing-placeholder",
          name,
          ...writtenAs(expected, name),
        });
  const passed = new Map<string, string>();
  if (syntax === "printf")
    (options.arguments ?? []).forEach((written, i) => {
      if (written) passed.set(String(i + 1), written);
    });
  // A Fluent translation may use a term its source does not: the term
  // is the locale's to define, not a value the code passes (#990).
  const ownTerm = (name: string) => syntax === "fluent" && name.startsWith("-");
  for (const name of actual.placeholders) {
    if (!allowedValues.has(name) && !passed.has(name) && !ownTerm(name))
      errors.push({
        code: "unexpected-placeholder",
        name,
        ...writtenAs(actual, name),
      });
  }
  // counterpart substitutes `%(name)s` only as written: `%(n)d` for the
  // source's `%(n)s` is text in the app (#663).
  if (syntax === "counterpart") {
    for (const [name, written] of expected.written) {
      const got = actual.written.get(name);
      if (got !== undefined && got !== written)
        errors.push(
          { code: "missing-placeholder", name, written },
          { code: "unexpected-placeholder", name, written: got },
        );
    }
  }
  if (syntax === "printf" || syntax === "android")
    errors = verbErrors(errors, expected, actual, passed, syntax);
  for (const [name, { type }] of expected.formats) {
    if (!actual.placeholders.has(name)) continue;
    const got = actual.formats.get(name)?.type ?? null;
    if (got !== type) {
      errors.push({
        code: "unexpected-format",
        name,
        expected: type,
        actual: got,
      });
    }
  }
  // Where a type is read as HTML its tags are not compared, so the
  // placeholders in their attributes are, apart from the text's (#948);
  // elsewhere a tag's attribute text is its identity and says as much.
  const attrErrors = (
    want: Map<string, string | undefined>,
    got: Map<string, string | undefined>,
  ) => {
    const missing = new Set(
      errors.flatMap((e) => (e.code === "missing-placeholder" ? [e.name] : [])),
    );
    for (const [name, written] of want)
      if (!got.has(name) && !missing.has(name))
        errors.push({
          code: "missing-placeholder",
          name,
          ...(written ? { written } : {}),
        });
    for (const [name, written] of got)
      if (
        !want.has(name) &&
        !allowedValues.has(name) &&
        !passed.has(name) &&
        !ownTerm(name)
      )
        errors.push({
          code: "unexpected-placeholder",
          name,
          ...(written ? { written } : {}),
        });
  };
  if (isHtml(options.richText)) {
    // A value moved out of an attribute into the text is said once,
    // where it went (#988).
    attrErrors(
      new Map(
        [...expected.attrPlaceholders].filter(
          ([name]) =>
            !(
              actual.placeholders.has(name) && !expected.placeholders.has(name)
            ),
        ),
      ),
      actual.attrPlaceholders,
    );
    // A Rails `_html` key's own markup, but a source's pair written with
    // nothing in it, `<a href="…"></a>` for a link, still hides its text.
    if (options.richText === "html-key")
      for (const name of expected.pairs)
        if (actual.tags.has(name) && !actual.pairs.has(name))
          errors.push({ code: "unpaired-tag", name });
  } else {
    for (const name of expected.tags) {
      if (!actual.tags.has(name)) errors.push({ code: "missing-tag", name });
      else if (expected.pairs.has(name) && !actual.pairs.has(name))
        errors.push({ code: "unpaired-tag", name });
    }
    for (const name of actual.tags) {
      if (!expected.tags.has(name))
        errors.push({ code: "unexpected-tag", name });
    }
  }
  // Under i18next and Android, and in a Rails `_html` key, a tag a
  // source writes as text is text, and so is one its translation writes
  // as often, the source's unclosed `<p>` or
  // stray `</br>`; one more, a close, or an open named as a tag of the
  // source's or HTML's (`<ul> <li>` added to Markdown), is a tag
  // broken, not prose, while `<sans titre>` is prose. The
  // placeholders in a prose tag's attributes are the text's, which
  // i18next fills (#986).
  if (
    options.richText === "html-key" ||
    ((syntax === "i18next" || syntax === "android") &&
      options.richText !== "html")
  ) {
    const names = new Set(
      [...expected.tags].map((identity) =>
        identity.split(" ")[0]!.toLowerCase(),
      ),
    );
    // A pair closed on itself is said once, as that: its first
    // unclosed open is that pair's, any more are broken besides.
    const unpaired = new Map<string, number>();
    for (const e of errors)
      if (e.code === "unpaired-tag") {
        const name = e.name.split(" ")[0]!.toLowerCase();
        unpaired.set(name, (unpaired.get(name) ?? 0) + 1);
      }
    const keyOf = (t: ProseTag) =>
      `${t.close ? "/" : ""}${t.name.toLowerCase()}`;
    // Counted per branch, a branch's allowance the most any branch of
    // the same argument has in the source: Polish's four branches may
    // each keep the `</br>` English's two do; outside every branch, the
    // text's own count; a place the source keeps none in, a plural
    // written flat or one the source lacks, the most any one place of
    // the source keeps.
    const scopeOf = (t: ProseTag) =>
      t.branch.length === 0
        ? ""
        : [
            ...t.branch.slice(0, -1),
            t.branch[t.branch.length - 1]!.split(":")[0]!,
          ].join("\u0000");
    const branchOf = (t: ProseTag) => t.branch.join("\u0000");
    const perBranch = new Map<string, number>();
    const allowed = new Map<string, number>();
    const most = new Map<string, number>();
    for (const t of proseTagsOf(source, syntax)) {
      const at = `${branchOf(t)}\u0001${keyOf(t)}`;
      const n = (perBranch.get(at) ?? 0) + 1;
      perBranch.set(at, n);
      const scope = `${scopeOf(t)}\u0001${keyOf(t)}`;
      allowed.set(scope, Math.max(allowed.get(scope) ?? 0, n));
      most.set(keyOf(t), Math.max(most.get(keyOf(t)) ?? 0, n));
    }
    // An element as markup writes one: bare, or with attributes, where
    // `<em andamento>` is Portuguese for "in progress".
    const markup = (t: ProseTag) =>
      isHtmlElement(t.name) &&
      (t.attrs === undefined || /^(?:\/|[\w:-]+\s*=)/.test(t.attrs));
    const seen = new Map<string, number>();
    for (const tag of proseTagsOf(target, syntax)) {
      const at = `${branchOf(tag)}\u0001${keyOf(tag)}`;
      const n = (seen.get(at) ?? 0) + 1;
      seen.set(at, n);
      const limit =
        allowed.get(`${scopeOf(tag)}\u0001${keyOf(tag)}`) ??
        most.get(keyOf(tag)) ??
        0;
      if (n <= limit) continue;
      if (tag.close)
        errors.push({
          code: "invalid-icu",
          where: "target",
          message: `unexpected </${tag.name}>`,
          position: tag.at,
        });
      else if (names.has(tag.name.toLowerCase()) || markup(tag)) {
        const name = tag.name.toLowerCase();
        const left = unpaired.get(name) ?? 0;
        if (left > 0) {
          unpaired.set(name, left - 1);
          continue;
        }
        errors.push({
          code: "invalid-icu",
          where: "target",
          message: `unclosed <${tag.name}>`,
          position: tag.at,
        });
      }
    }
    // A value a real tag's attribute writes in one and a prose tag's
    // in the other is a tag broken, said above, not a value moved; one
    // moved into the text is said once, where it went.
    const inAttrs = (shape: Shape, name: string) =>
      shape.attrPlaceholders.has(name);
    if (!isHtml(options.richText))
      attrErrors(
        new Map(
          [...expected.proseAttrPlaceholders].filter(
            ([name]) =>
              !inAttrs(actual, name) && !actual.placeholders.has(name),
          ),
        ),
        new Map(
          [...actual.proseAttrPlaceholders].filter(
            ([name]) => !inAttrs(expected, name),
          ),
        ),
      );
    // An attribute whose quote never closes swallows the text after it,
    // where the source's tags close theirs: ia's `<a href="%{path}>`
    // (#988).
    // Attribute text with its quoted values taken out: a quote left is
    // one no value closes, `title="l'été"` none; only text shaped as
    // attributes, so `<nom d'utilisateur>` is prose.
    const openQuote = (attrs: string) =>
      attrs.includes("=") && /["']/.test(attrs.replace(/"[^"]*"|'[^']*'/g, ""));
    const attrsOf = (shape: Shape, prose: ProseTag[]) => [
      ...[...shape.tags].flatMap((identity) => {
        const at = identity.indexOf(" ");
        return at < 0
          ? []
          : [{ name: identity.slice(0, at), attrs: identity.slice(at + 1) }];
      }),
      ...prose.flatMap((t) =>
        t.attrs === undefined ? [] : [{ name: t.name, attrs: t.attrs }],
      ),
    ];
    if (
      options.richText === "html-key" &&
      !attrsOf(expected, proseTagsOf(source, syntax)).some((t) =>
        openQuote(t.attrs),
      )
    )
      for (const tag of attrsOf(actual, proseTagsOf(target, syntax)))
        if (openQuote(tag.attrs))
          errors.push({
            code: "invalid-icu",
            where: "target",
            message: `<${tag.name} ${tag.attrs}> opens a quote it never closes`,
            position: Math.max(0, target.indexOf(`<${tag.name} ${tag.attrs}`)),
          });
  }
  // Fluent selects asymmetrically (#1032): a translation may select on
  // whatever it is passed, a key it lacks falls back to its `*` default,
  // and one on a variable never passed renders that default, a warning.
  // A term's attribute is the locale's to select on. What is passed is
  // the source's whole, a flattened plural's value included.
  const wholeValues = valuesOf(whole);
  const unpassed = (arg: string): ValidationError[] =>
    wholeValues.has(arg) ||
    whole.selects.has(arg) ||
    passed.has(arg) ||
    arg.startsWith("-") ||
    options.term
      ? []
      : [{ code: "unpassed-selector", arg }];
  // The keys Fluent never matches, each select of the translation on
  // `arg` by itself; the `*` default is chosen whatever its key, and the
  // reader carries it as `other` beside it with its text, so a key whose
  // text is `other`'s is the default, never a finding.
  const fluentSelectErrors = (arg: string): ValidationError[] => {
    const sourceKeys = whole.selects.get(arg);
    const counted = whole.plurals.has(arg);
    const out = new Map<string, ValidationError>();
    const add = (error: ValidationError & { key: string }) =>
      out.set(`${error.code} ${error.key}`, error);
    if (!counted && !sourceKeys)
      for (const error of unpassed(arg)) out.set(error.code, error);
    for (const node of branchingNodes(parsedTarget.nodes)) {
      if (node.kind !== "select" || node.arg !== arg) continue;
      const fallback = JSON.stringify(node.branches.other);
      const own = Object.entries(node.branches)
        .filter(([k, b]) => k !== "other" && JSON.stringify(b) !== fallback)
        .map(([k]) => k);
      // A count selected on a word never matches it: Fluent compares a
      // number with categories and numbers only (gl `[unha]`, #597).
      if (counted) {
        for (const key of own)
          if (
            !(PLURAL_CATEGORIES as readonly string[]).includes(key) &&
            !/^\d+$/.test(key)
          )
            add({ code: "unexpected-branch", arg, key });
        continue;
      }
      // A term's keys are its locale's, which that locale's messages
      // pass (cs `[lower]` for en's `[lowercase]`).
      if (!sourceKeys || options.term) continue;
      // A key the source's in another case never matches it (ga-IE
      // `[Seconds]` for `[seconds]`), and two keys or more of its own and
      // none of the source's are the source's translated (da `[sekunder]`
      // for `[seconds]`); keeping some, as fi does, or collapsing to the
      // default, as de does, is Fluent's way.
      for (const key of own) {
        const meant = [...sourceKeys].find(
          (s) =>
            s !== key &&
            s.toLowerCase() === key.toLowerCase() &&
            !Object.hasOwn(node.branches, s),
        );
        if (meant) add({ code: "missing-branch", arg, key: meant });
      }
      if (own.length >= 2 && own.every((k) => !sourceKeys.has(k)))
        for (const key of sourceKeys)
          if (key !== "other") add({ code: "missing-branch", arg, key });
    }
    return [...out.values()];
  };
  errors.push(
    ...pluralErrors(
      actual,
      expectedValues,
      passed,
      syntax === "fluent"
        ? { unpassed, sourcePlurals: new Set(whole.plurals.keys()) }
        : undefined,
      (ordinal) =>
        language === undefined
          ? { required: [], allowed: [] }
          : pluralCategoriesFor(
              language,
              syntax,
              ordinal ? undefined : options.pluralForms,
              ordinal,
            ),
      language,
      // A language of the source's base shares its grammar, so the source
      // author has already said which categories its text varies by
      // (#1005): an en-GB copy of an `other`-only plural is complete.
      sameBase
        ? { cardinal: whole.cardinalPlurals, ordinal: whole.ordinalPlurals }
        : undefined,
    ),
  );
  // An ordinal is picked by another rule than a cardinal (#995): a
  // translation's plural of a kind the source has none of on that
  // argument, where the source has the other.
  for (const [ordinal, map] of kinds(actual))
    for (const arg of map.keys()) {
      const same = ordinal ? whole.ordinalPlurals : whole.cardinalPlurals;
      const other = ordinal ? whole.cardinalPlurals : whole.ordinalPlurals;
      if (!same.has(arg) && other.has(arg))
        errors.push({ code: "changed-ordinal", arg, ordinal: !ordinal });
    }
  // Fluent's writer renders a select inside any variant (#990).
  if (syntax !== "fluent")
    errors.push(...nestingErrors(sourceNodes, targetNodes));
  // The source's own text keeps the source's warning, not an error: a
  // translation that is the source cannot be the translator's `#` (#923).
  if (target !== source)
    for (const arg of countsInSelects(parsedTarget.nodes))
      errors.push({ code: "nested-count", arg });
  for (const [arg, keys] of actual.selects) {
    const sourceKeys = expected.selects.get(arg);
    if (syntax === "fluent") {
      errors.push(...fluentSelectErrors(arg));
      continue;
    }
    if (!sourceKeys) {
      errors.push({ code: "unknown-select", arg });
      continue;
    }
    for (const key of sourceKeys) {
      if (!keys.has(key)) errors.push({ code: "missing-branch", arg, key });
    }
    for (const key of keys) {
      if (!sourceKeys.has(key))
        errors.push({ code: "unexpected-branch", arg, key });
    }
  }

  // A category missing falls back to `other`, and one the language never
  // selects is dead text: neither breaks the message (#556, #651).
  const warning = (e: ValidationError) =>
    e.code === "missing-category" ||
    e.code === "unexpected-category" ||
    e.code === "unpassed-selector" ||
    e.code === "flattened-plural" ||
    e.code === "count-for-marker";
  const incomplete = errors.filter(warning);
  const invalid = errors.filter((e) => !warning(e));
  if (invalid.length === 0) {
    return incomplete.length === 0 ? { ok: true } : { ok: true, incomplete };
  }
  return incomplete.length === 0
    ? { ok: false, errors: invalid }
    : { ok: false, errors: invalid, incomplete };
}

// printf's and Android's verbs: each position's against the source's,
// said as one dropped verb where that is what the translation did; the
// errors so far, and these, as the result.
function verbErrors(
  errors: ValidationError[],
  expected: Shape,
  actual: Shape,
  passed: Map<string, string>,
  syntax: "printf" | "android",
): ValidationError[] {
  // The index form follows the source: `%n$` where it writes one (C,
  // Java, JavaScript's sprintf, Android), Go's `%[n]` where it writes
  // that, and both where it writes neither, since only the project's
  // language decides and Go has no `%n$` nor sprintf-js a `%[n]` (#645).
  const writtenForms = [...expected.written.values()];
  const posix =
    syntax === "android" || writtenForms.some((w) => /^%\d+\$/.test(w));
  const go = writtenForms.some((w) => /^%\[\d+\]/.test(w));
  const indexFor = (verb: string) =>
    posix ? `%n$${verb}` : go ? `%[n]${verb}` : `%n$${verb} or %[n]${verb}`;
  // The verb is the modifier and the letter together: `%ld` against
  // `%lu` is a changed verb (#614).
  const verbOf = (written: string) => printfVerbOf(written) ?? written;
  const changed: Extract<ValidationError, { code: "changed-verb" }>[] = [];
  const positions = [...expected.written.keys()];
  const verbs = [...actual.verbs].sort(
    ([a], [b]) => positions.indexOf(a) - positions.indexOf(b),
  );
  // A position's verbs are every verb the source writes there: each
  // Android plural item numbers its own from 1 (#596).
  const allowed = new Map<string, Set<string>>();
  for (const [name, written] of expected.verbs)
    if (written !== "%arg")
      allowed.set(name, (allowed.get(name) ?? new Set()).add(verbOf(written)));
  // The key's type where the text writes no verb of its own there.
  for (const [name, written] of passed)
    if (!allowed.has(name)) allowed.set(name, new Set([verbOf(written)]));
  const said = new Set<string>();
  // A String Catalog's `%arg` is its argument whatever the verb (#726).
  // Unless the key says what type it is.
  const any = new Set(
    expected.verbs
      .filter(([name, w]) => w === "%arg" && !passed.has(name))
      .map(([name]) => name),
  );
  for (const [name, got] of verbs) {
    const own = expected.written.get(name);
    const written =
      own === undefined || own === "%arg" ? (passed.get(name) ?? own) : own;
    if (
      written === undefined ||
      got === "%arg" ||
      (any.has(name) && verbOf(got) !== "a") ||
      allowed.get(name)?.has(verbOf(got))
    )
      continue;
    if (said.has(name)) continue;
    said.add(name);
    changed.push({
      code: "changed-verb",
      name,
      expected: written,
      actual: got,
      indexed: indexFor(verbOf(got)),
      moved: expected.verbs.some(
        ([other, w]) => other !== name && verbOf(w) === verbOf(got),
      ),
    });
  }
  // One dropped verb shifts every verb after it one place: read by
  // position that is a changed verb at each place from the drop on and
  // a missing last, and it is said as the one omission it is (#614).
  // Anything else, a reorder or a drop beside a change, is said as it
  // reads.
  const drop = droppedVerb(expected, actual, changed, errors, verbOf);
  return drop ? [drop] : [...errors, ...changed];
}

function pluralErrors(
  actual: Shape,
  expectedValues: Set<string>,
  passed: Map<string, string>,
  // Fluent's rules: a plural on a value the source has none of, and a
  // select of its `*[other]` alone, which reads as a plural, on a value
  // the source never counts: no categories to pick (#1032).
  fluent:
    | {
        unpassed: (arg: string) => ValidationError[];
        sourcePlurals: ReadonlySet<string>;
      }
    | undefined,
  // A cardinal plural's categories, or a selectordinal's (#995).
  categoriesFor: (ordinal: boolean) => {
    required: string[];
    allowed: string[];
  },
  language: string | undefined,
  // The source's own keys by kind and argument, for a language of its
  // base.
  sourceKeys?: {
    cardinal: Map<string, Set<string>>;
    ordinal: Map<string, Set<string>>;
  },
): ValidationError[] {
  const out: ValidationError[] = [];
  const byKind = [
    [false, actual.cardinalPlurals],
    [true, actual.ordinalPlurals],
  ] as const;
  for (const [ordinal, plurals] of byKind)
    for (const [arg, keys] of plurals) {
      const categories = categoriesFor(ordinal);
      if (!expectedValues.has(arg) && !passed.has(arg)) {
        out.push(
          ...(fluent?.unpassed(arg) ?? [{ code: "unknown-plural", arg }]),
        );
        continue;
      }
      if (
        fluent &&
        keys.size === 1 &&
        keys.has("other") &&
        !fluent.sourcePlurals.has(arg)
      )
        continue;
      if (categories.required.length === 0) continue;
      // `=01` is not `=1` to the runtimes, which match the key as written.
      const exact = new Set(
        [...keys]
          .filter((k) => EXACT_KEY.test(k))
          .map((k) => Number(k.slice(1))),
      );
      const own = (ordinal ? sourceKeys?.ordinal : sourceKeys?.cardinal)?.get(
        arg,
      );
      for (const key of categories.required) {
        if (own && key !== "other" && !own.has(key)) continue;
        if (
          !keys.has(key) &&
          !(language && pluralCategoryCovered(language, key, exact, ordinal))
        )
          out.push({ code: "missing-category", arg, key });
      }
      for (const key of keys) {
        if (!key.startsWith("=") && !categories.allowed.includes(key))
          out.push({ code: "unexpected-category", arg, key });
      }
    }
  return out;
}

// A writer that holds a plural as its forms (Android's <plurals>, a
// plural object) reads a target nested the other way as no plural.
function nestingErrors(
  sourceNodes: IcuNode[],
  targetNodes: IcuNode[],
): ValidationError[] {
  const nested = nestingOf(sourceNodes);
  return [...nestingOf(targetNodes)].flatMap((pair) => {
    if (nested.has(pair)) return [];
    const [outer, inner] = pair.split(" ") as [string, string];
    return [{ code: "changed-nesting" as const, outer, inner }];
  });
}

// The one omission a shifted tail is (#614): the translation writes one
// verb fewer, the only missing position is the source's last, every
// verb from the first changed position on is the source's next verb,
// and nothing is unexpected. Then the source's verb at the first changed
// position is what was dropped. Undefined for any other reading.
function droppedVerb(
  expected: Shape,
  actual: Shape,
  changed: Extract<ValidationError, { code: "changed-verb" }>[],
  errors: ValidationError[],
  verbOf: (written: string) => string,
): ValidationError | undefined {
  if (actual.count !== expected.count - 1 || changed.length === 0) return;
  const positions = [...expected.written.keys()].map(Number);
  const last = Math.max(...positions);
  const missing = errors.filter((e) => e.code === "missing-placeholder");
  if (errors.length !== missing.length) return;
  if (missing.length !== 1 || missing[0]!.name !== String(last)) return;
  const first = Math.min(...changed.map((c) => Number(c.name)));
  for (let n = first; n < last; n++) {
    const got = actual.written.get(String(n));
    const next = expected.written.get(String(n + 1));
    if (got === undefined || next === undefined || verbOf(got) !== verbOf(next))
      return;
  }
  const written = expected.written.get(String(first));
  return {
    code: "missing-placeholder",
    name: String(first),
    ...(written ? { written } : {}),
  };
}
