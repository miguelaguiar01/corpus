# Handoff: installing Corpus in a project of your own

You are receiving Corpus to install in a real project and to report on how it went. This page is everything you need: the install steps, how to describe text that carries tags, relations and many entities, and what the report should cover. The binding reference for anything not covered here is [the design spec](corpus-design.md).

## 1. Run an instance

You need Docker. Both commands are run once, in a folder you keep:

```sh
git clone https://github.com/miguelaguiar01/corpus.git
cd corpus
docker build -t corpus .
docker run -d --name corpus -p 3000:3000 \
  -e CORPUS_INVITE_SECRET="$(openssl rand -hex 24)" \
  -v corpus-data:/data corpus
```

Open http://localhost:3000. Join with the invite secret, a display name and a password; the first person to join is the maintainer. Create a project under **New project**: its slug is what the config below names, and the page shows the project's push token once. Keep it.

## 2. Install the CLI in your repository

```sh
npm install --save-dev @corpus-tool/cli
npx corpus init --project <slug> --source <lang> --languages <lang,lang> \
  --messages "src/i18n/{lang}.json" --server http://localhost:3000
export CORPUS_TOKEN=<the token from the project page>
npx corpus push
```

`init` writes `corpus.config.ts` for a plain message catalog. Node 22 or later; the config is TypeScript and needs no build step. If your text is not a plain catalog, edit the config as the next section describes before the first push.

## 3. Describing structured text

Corpus never discovers strings; the config declares where they live and what they carry. Three things describe a project with tags, relations and many entities.

### String types and their fields

Each string has a `type`, and each type declares its metadata fields. Every field has a `description` (shown as its tooltip) and one of five primitives:

| Primitive | Use it for | In the UI |
| --- | --- | --- |
| `enum` | a tag from a fixed set | chip, facet filter |
| `flag` | a boolean tag | chip, facet filter |
| `text` | a free note for the translator | inline note |
| `ref`, `list<ref>` | a relation to one entity or to several | entity card in the editor, facet filter |
| `placeholders` | the named slots the text must keep | insertable chips, validated on save |

```ts
stringTypes: {
  dialogue: {
    mood: { type: "enum", description: "Delivery of the line.", values: ["calm", "angry"] },
    optional: { type: "flag", description: "Skipped when the player rushes." },
    speaker: { type: "ref", description: "Who says it.", entityType: "character" },
    mentions: { type: "list<ref>", description: "Everyone the line refers to.", entityType: "character" },
    note: { type: "text", description: "Anything the primitives cannot say." },
    slots: {
      type: "placeholders",
      description: "Values the engine fills in.",
      slots: { player: { description: "The player's name." } },
    },
  },
},
```

A string of that type then carries `metadata: { mood: "calm", optional: true, speaker: "character:ana", mentions: ["character:rui"] }`. Metadata is read-only in Corpus and optional: a type with no fields works.

### Entities

Entities are the things strings talk about: characters, rooms, items, quests. They are not translated; they give translators context and give `ref` fields a target. Declare each entity type with a label, and ship each entity with a stable id, its type, a name, and free string attributes:

```ts
entityTypes: { character: { label: "Character" }, room: { label: "Room" } },
```

```json
{ "id": "character:ana", "type": "character", "name": "Ana", "attributes": { "age": "34", "home": "The lighthouse" } }
```

Ids are the identity across pushes: a string or entity keeps its id, or it is archived and a new one is created. Ids may contain letters, digits, `.`, `_`, `-` and `:`.

### Sources

Three adapters, mixed freely in `sources`:

- **`messages`**: a flat or nested key-value catalog per language, `path` with `{lang}`. Zero configuration.
- **`table`**: a JSON or TypeScript module exporting rows; `map` names the id and text fields, and every other string, boolean or string-array field becomes metadata of the declared `type`.
- **`exec`**: a command in your repository that prints a JSON document `{ "strings": [...], "entities": [...] }` to stdout, using the string entry and entity shapes above. This is the one for computed metadata, templates, pre-rendered examples, and entities, since only your code knows your corpus. An optional `importCommand` receives, on stdin, the pulled translations for the strings the file adapters did not claim.

```ts
sources: [
  { adapter: "messages", type: "chrome", path: "src/i18n/{lang}.json" },
  { adapter: "table", type: "tutorial-step", path: "src/tutorial/steps.ts", map: { id: "id", text: "text" } },
  { adapter: "exec", command: "npx tsx scripts/corpus-export.ts", importCommand: "npx tsx scripts/corpus-import.ts" },
],
```

Source text may use ICU placeholders `{name}` and `select` (`{g, select, m {…} f {…}}`) and nothing else; anything else is rejected at push with the string named. Strings may carry `examples`, each with slot values and the source render, and the editor previews the draft with them.

### Completeness

`npx corpus check` scans the directories in `check.include` for user-facing string literals outside the declared sources; `check.allow` takes regexes for text that is not chrome (brand names, codes), and a `corpus-ignore` comment silences a line. Wire it into your CI so a push is complete by construction.

## 4. Working with it

`corpus push` is a diff by id: new ids are added, changed source text marks its translations stale, missing ids are archived with history kept. `corpus pull` writes verified translations back through the same adapters and prints only the files it changed; `--min-state translated` includes drafts. Push, then pull, must reproduce your repository byte for byte.

In the web app: the dashboard's three queues say what to work on; the catalogue filters by type, state, language and every enum, flag and ref you declared; the editor shows the source with its branches, chips, metadata, entities and examples, and previews the draft live; the entity browser lists every entity by type. It is designed for a phone first.

## 5. The report

File it as an issue on the Corpus repository and mention epic #208. Cover, in this order, with exact commands and messages where they exist:

1. **Install friction.** Anything between `docker run` and the first successful `push` that was unclear, surprising or wrong, including the README and this page.
2. **The config.** What you had to express and how; where the five primitives, `table` and `exec` fit; what you could not express, and what you did instead.
3. **Push.** Every rejection and its message; whether the message named the string and the fix; push time and snapshot size at your scale (number of strings, entities, languages).
4. **The surfaces at your scale.** The catalogue's facets, the entity browser, the editor's related-entities rail on strings that reference many entities, the queues: what was slow, cramped, or hard to find, on a phone and on a desktop.
5. **Pull and round trip.** Whether the files came back as you keep them, and what the diff looked like in your version control.
6. **Anything else**, including what you liked, since that tells the maintainers what not to change.

Every item becomes a ticket; the must-fix ones are fixed before the milestone closes.
