`corpus mcp` is a Model Context Protocol server over stdio. It gives an agent the same operations the editor gives a person, against the same rules, so a coding agent that already has your repository open can work the untranslated queue without a browser and without a person pasting strings into a chat.

It runs in the repository, reads `corpus.config.ts` for the project and the server, and `.corpus/token` or `CORPUS_TOKEN` for the token. There is nothing else to configure.

```sh
npx corpus mcp
```

Nothing is printed on stdout but protocol, so a stray `console.log` in a client's wrapper is the usual reason a connection fails.

## The clients

**Claude Code.** `claude mcp add corpus -- npx corpus mcp`, or the repository's `.mcp.json`, which the team shares through git:

```json
{ "mcpServers": { "corpus": { "command": "npx", "args": ["corpus", "mcp"] } } }
```

**Claude Desktop.** The same `mcpServers` entry in `claude_desktop_config.json`, but the app does not start in your repository, so give it one that changes directory:

```json
{
  "mcpServers": {
    "corpus": {
      "command": "sh",
      "args": ["-c", "cd /path/to/repo && npx corpus mcp"]
    }
  }
}
```

**Cursor.** The same `mcpServers` entry in the repository's `.cursor/mcp.json`.

**VS Code, Copilot agent mode.** The repository's `.vscode/mcp.json`, which names the transport:

```json
{
  "servers": {
    "corpus": { "type": "stdio", "command": "npx", "args": ["corpus", "mcp"] }
  }
}
```

**OpenAI Codex CLI.** In `~/.codex/config.toml`:

```toml
[mcp_servers.corpus]
command = "npx"
args = ["corpus", "mcp"]
```

**Gemini CLI.** The same `mcpServers` entry with `"cwd": "/path/to/repo"`, in `~/.gemini/settings.json` or the repository's `.gemini/settings.json`.

**OpenAI Agents SDK.** `MCPServerStdio(params={"command": "npx", "args": ["corpus", "mcp"], "cwd": "/path/to/repo"})`.

**Anything else.** The server speaks the tools subset — `initialize`, `tools/list`, `tools/call` — as newline-delimited JSON-RPC on stdio, so a client with no configuration file at all spawns the process and writes to it.

## The tools

Nine, each one API call.

| Tool | What it does |
|---|---|
| `list_queue` | A queue's items: `untranslated`, `stale`, `unverifiedSource` or `agentDrafts`, narrowed by language, by string type, or both |
| `get_string` | One string: the source, its placeholders, selects and plurals, every language's text and state, the type's note, the glossary terms it contains, the entities it refers to, its siblings under the same key prefix, and any pending proposal |
| `save_draft` | A translation for one string in one language |
| `propose_change` | New source text for a string, as a proposal |
| `propose_removal` | A string the repository should drop, as a proposal |
| `add_string` | A new string into one of the repository's writable sources, as a proposal |
| `list_proposals` | The pending proposals, the agent's own marked |
| `withdraw_proposal` | One of the agent's own |
| `status` | The project's numbers, its languages, and which sources can take proposals |

The rules an agent works under are not in this table; the server states them itself, in the `instructions` the handshake returns, so a client that reads them needs no prompt of yours. [What an agent may and may not do](What-an-agent-may-and-may-not-do) is the same rules for a person.

## A session

Six messages against a real instance, recorded rather than written. The repository has two strings and no Portuguese.

<!-- from: recorded/mcp-session.txt -->
```text
→ {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"wiki","version":"0"}}}
← {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{"tools":{}},"serverInfo":{"name":"corpus","version":"0.16.0"},"instructions":"Corpus holds this repository's strings and their translations. A draft you save lands on an untranslated row, a stale row or your own earlier draft; a row a person edited refuses with human-edited, so propose a change instead of retrying. Every draft is attributed to the project's agent actor and waits for a maintainer to verify it; you cannot verify. Placeholders and selects must survive translation. Proposals go into the project's writable sources, which status lists as writableSources; a project pushed before sources were declared has none until its next corpus push. A proposal stays pending until its change is pulled, committed and pushed and the next corpus push sees it; list_proposals shows the pending ones and withdraw_proposal takes back one of yours."}}
→ {"jsonrpc":"2.0","method":"notifications/initialized"}
→ {"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_queue","arguments":{"queue":"untranslated","language":"pt-PT"}}}
← {"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"{\n  \"queue\": \"untranslated\",\n  \"count\": 2,\n  \"items\": [\n    {\n      \"key\": \"editor.save\",\n      \"language\": \"pt-PT\",\n      \"type\": \"ui\",\n      \"source\": \"Save\",\n      \"text\": null\n    },\n    {\n      \"key\": \"editor.unsaved\",\n      \"language\": \"pt-PT\",\n      \"type\": \"ui\",\n      \"source\": \"You have {count, plural, one {# change} other {# changes}}\",\n      \"text\": null\n    }\n  ]\n}"}],"structuredContent":{"queue":"untranslated","count":2,"items":[{"key":"editor.save","language":"pt-PT","type":"ui","source":"Save","text":null},{"key":"editor.unsaved","language":"pt-PT","type":"ui","source":"You have {count, plural, one {# change} other {# changes}}","text":null}]}}}
→ {"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_string","arguments":{"key":"editor.unsaved"}}}
← {"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"{\n  \"key\": \"editor.unsaved\",\n  \"type\": \"ui\",\n  \"source\": \"You have {count, plural, one {# change} other {# changes}}\",\n  \"sourceLanguage\": \"en\",\n  \"file\": \"src/i18n/en.json\",\n  \"archived\": false,\n  \"placeholders\": [],\n  \"selects\": [],\n  \"plurals\": [\n    \"count\"\n  ],\n  \"tags\": [],\n  \"syntax\": \"icu\",\n  \"slots\": [\n    {\n      \"name\": \"count\",\n      \"description\": null,\n      \"role\": null,\n      \"values\": {}\n    }\n  ],\n  \"examples\": [],\n  \"metadata\": null,\n  \"note\": null,\n  \"glossary\": {},\n  \"entities\": [],\n  \"translations\": {\n    \"en\": {\n      \"state\": \"translated\",\n      \"stale\": false,\n      \"text\": null,\n      \"agentDraft\": false\n    },\n    \"pt-PT\": {\n      \"state\": \"untranslated\",\n      \"stale\": false,\n      \"text\": null,\n      \"agentDraft\": false\n    }\n  },\n  \"proposal\": null,\n  \"siblings\": [\n    {\n      \"key\": \"editor.save\",\n      \"source\": \"Save\",\n      \"translations\": {\n        \"pt-PT\": {\n          \"state\": \"untranslated\",\n          \"stale\": false,\n          \"text\": null\n        }\n      }\n    }\n  ],\n  \"siblingCount\": 1\n}"}],"structuredContent":{"key":"editor.unsaved","type":"ui","source":"You have {count, plural, one {# change} other {# changes}}","sourceLanguage":"en","file":"src/i18n/en.json","archived":false,"placeholders":[],"selects":[],"plurals":["count"],"tags":[],"syntax":"icu","slots":[{"name":"count","description":null,"role":null,"values":{}}],"examples":[],"metadata":null,"note":null,"glossary":{},"entities":[],"translations":{"en":{"state":"translated","stale":false,"text":null,"agentDraft":false},"pt-PT":{"state":"untranslated","stale":false,"text":null,"agentDraft":false}},"proposal":null,"siblings":[{"key":"editor.save","source":"Save","translations":{"pt-PT":{"state":"untranslated","stale":false,"text":null}}}],"siblingCount":1}}}
→ {"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"save_draft","arguments":{"key":"editor.unsaved","language":"pt-PT","text":"Tem {count, plural, one {# alteração} other {# alterações}}"}}}
← {"jsonrpc":"2.0","id":4,"result":{"content":[{"type":"text","text":"invalid-translation: Plural count is missing the many branch this language uses"}],"isError":true}}
→ {"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"save_draft","arguments":{"key":"editor.unsaved","language":"pt-PT","text":"Tem {count, plural, one {# alteração} many {# de alterações} other {# alterações}}"}}}
← {"jsonrpc":"2.0","id":5,"result":{"content":[{"type":"text","text":"{\n  \"key\": \"editor.unsaved\",\n  \"language\": \"pt-PT\",\n  \"state\": \"translated\",\n  \"text\": \"Tem {count, plural, one {# alteração} many {# de alterações} other {# alterações}}\",\n  \"actor\": \"acme-app agent\"\n}"}],"structuredContent":{"key":"editor.unsaved","language":"pt-PT","state":"translated","text":"Tem {count, plural, one {# alteração} many {# de alterações} other {# alterações}}","actor":"acme-app agent"}}}
→ {"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"status","arguments":{}}}
← {"jsonrpc":"2.0","id":6,"result":{"content":[{"type":"text","text":"{\n  \"project\": \"acme-app\",\n  \"sourceLanguage\": \"en\",\n  \"languages\": [\n    \"en\",\n    \"pt-PT\"\n  ],\n  \"strings\": 2,\n  \"lastPushAt\": \"2026-09-22T01:59:35.180Z\",\n  \"version\": \"v0.16.0\",\n  \"pendingProposals\": 0,\n  \"writableSources\": [\n    \"src/i18n/{lang}.json\"\n  ],\n  \"progress\": {\n    \"perLanguage\": {\n      \"en\": {\n        \"untranslated\": 0,\n        \"translated\": 2,\n        \"verified\": 0,\n        \"stale\": 0,\n        \"total\": 2\n      },\n      \"pt-PT\": {\n        \"untranslated\": 1,\n        \"translated\": 1,\n        \"verified\": 0,\n        \"stale\": 0,\n        \"total\": 2\n      }\n    },\n    \"perType\": {\n      \"ui\": {\n        \"en\": {\n          \"untranslated\": 0,\n          \"translated\": 2,\n          \"verified\": 0,\n          \"stale\": 0,\n          \"total\": 2\n        },\n        \"pt-PT\": {\n          \"untranslated\": 1,\n          \"translated\": 1,\n          \"verified\": 0,\n          \"stale\": 0,\n          \"total\": 2\n        }\n      }\n    }\n  }\n}"}],"structuredContent":{"project":"acme-app","sourceLanguage":"en","languages":["en","pt-PT"],"strings":2,"lastPushAt":"2026-09-22T01:59:35.180Z","version":"v0.16.0","pendingProposals":0,"writableSources":["src/i18n/{lang}.json"],"progress":{"perLanguage":{"en":{"untranslated":0,"translated":2,"verified":0,"stale":0,"total":2},"pt-PT":{"untranslated":1,"translated":1,"verified":0,"stale":0,"total":2}},"perType":{"ui":{"en":{"untranslated":0,"translated":2,"verified":0,"stale":0,"total":2},"pt-PT":{"untranslated":1,"translated":1,"verified":0,"stale":0,"total":2}}}}}}}
```

That is the wire. Decoded, each call's result:

<!-- from: recorded/mcp-results.txt -->
```text
list_queue {"queue":"untranslated","language":"pt-PT"}
  {
    "queue": "untranslated",
    "count": 2,
    "items": [
      {
        "key": "editor.save",
        "language": "pt-PT",
        "type": "ui",
        "source": "Save",
        "text": null
      },
      {
        "key": "editor.unsaved",
        "language": "pt-PT",
        "type": "ui",
        "source": "You have {count, plural, one {# change} other {# changes}}",
        "text": null
      }
    ]
  }

get_string {"key":"editor.unsaved"}
  {
    "key": "editor.unsaved",
    "type": "ui",
    "source": "You have {count, plural, one {# change} other {# changes}}",
    "sourceLanguage": "en",
    "file": "src/i18n/en.json",
    "archived": false,
    "placeholders": [],
    "selects": [],
    "plurals": [
      "count"
    ],
    "tags": [],
    "syntax": "icu",
    "slots": [
      {
        "name": "count",
        "description": null,
        "role": null,
        "values": {}
      }
    ],
    "examples": [],
    "metadata": null,
    "note": null,
    "glossary": {},
    "entities": [],
    "translations": {
      "en": {
        "state": "translated",
        "stale": false,
        "text": null,
        "agentDraft": false
      },
      "pt-PT": {
        "state": "untranslated",
        "stale": false,
        "text": null,
        "agentDraft": false
      }
    },
    "proposal": null,
    "siblings": [
      {
        "key": "editor.save",
        "source": "Save",
        "translations": {
          "pt-PT": {
            "state": "untranslated",
            "stale": false,
            "text": null
          }
        }
      }
    ],
    "siblingCount": 1
  }

save_draft {"key":"editor.unsaved","language":"pt-PT","text":"Tem {count, plural, one {# alteração} other {# alterações}}"}
  refused: invalid-translation: Plural count is missing the many branch this language uses

save_draft {"key":"editor.unsaved","language":"pt-PT","text":"Tem {count, plural, one {# alteração} many {# de alterações} other {# alterações}}"}
  {
    "key": "editor.unsaved",
    "language": "pt-PT",
    "state": "translated",
    "text": "Tem {count, plural, one {# alteração} many {# de alterações} other {# alterações}}",
    "actor": "acme-app agent"
  }

status {}
  {
    "project": "acme-app",
    "sourceLanguage": "en",
    "languages": [
      "en",
      "pt-PT"
    ],
    "strings": 2,
    "lastPushAt": "2026-09-22T01:59:35.180Z",
    "version": "v0.16.0",
    "pendingProposals": 0,
    "writableSources": [
      "src/i18n/{lang}.json"
    ],
    "progress": {
      "perLanguage": {
        "en": {
          "untranslated": 0,
          "translated": 2,
          "verified": 0,
          "stale": 0,
          "total": 2
        },
        "pt-PT": {
          "untranslated": 1,
          "translated": 1,
          "verified": 0,
          "stale": 0,
          "total": 2
        }
      },
      "perType": {
        "ui": {
          "en": {
            "untranslated": 0,
            "translated": 2,
            "verified": 0,
            "stale": 0,
            "total": 2
          },
          "pt-PT": {
            "untranslated": 1,
            "translated": 1,
            "verified": 0,
            "stale": 0,
            "total": 2
          }
        }
      }
    }
  }
```

The fourth message is the one worth reading. The draft was refused, `isError` with a reason, because Portuguese uses a `many` plural category that English does not have and the draft had only `one` and `other`. The agent fixed it and the next call landed as `translated`, attributed to `acme-app agent`. That is the loop: Corpus refuses structurally wrong text at the point it is written rather than at build time, and says which branch is missing.

## What it costs

One process, started by the client, living as long as the session. Every call is one HTTP request to the instance. There is no polling and no local database: the server holds nothing between calls.

## When it does not connect

`corpus mcp` exits before speaking protocol when there is no token — `CORPUS_TOKEN is not set and .corpus/token does not exist` — which a client usually reports as the server failing to start. A workbench in the repository writes that token itself; a team instance gives it to you from `corpus project create`.

A client that starts in your home directory rather than your repository gets the same error for the same reason, which is why the Claude Desktop entry above changes directory first.
