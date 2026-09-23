`corpus agent` is the same operations as shell commands, for an agent with a terminal and no MCP client, or for a script. It reads the same config and the same token, calls the same API, and obeys the same rules.

Every subcommand prints the API's JSON and exits 1 with the server's message when the call is refused.

<!-- from: recorded/agent-session.txt -->
```text
$ corpus agent queue untranslated --lang pt-PT
  {
    "queue": "untranslated",
    "count": 1,
    "items": [
      {
        "key": "editor.save",
        "language": "pt-PT",
        "type": "ui",
        "source": "Save",
        "text": null
      }
    ]
  }

$ corpus agent string editor.save
  {
    "key": "editor.save",
    "type": "ui",
    "source": "Save",
    "sourceLanguage": "en",
    "file": "src/i18n/en.json",
    "archived": false,
    "placeholders": [],
    "selects": [],
    "plurals": [],
    "tags": [],
    "library": "icu",
    "syntax": "icu",
    "slots": [],
    "examples": [],
    "metadata": null,
    "note": null,
    "stringNote": null,
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
        "key": "editor.unsaved",
        "source": "You have {count, plural, one {# change} other {# changes}}",
        "translations": {
          "pt-PT": {
            "state": "translated",
            "stale": false,
            "text": "Tem {count, plural, one {# alteração} many {# de alterações} other {# alterações}}"
          }
        }
      }
    ],
    "siblingCount": 1
  }

$ corpus agent draft editor.save pt-PT "Guardar"
  {
    "key": "editor.save",
    "language": "pt-PT",
    "state": "translated",
    "text": "Guardar",
    "actor": "acme-app agent"
  }

$ corpus agent propose editor.save --text "Save the document"
  {
    "id": 1,
    "kind": "edit",
    "key": "editor.save",
    "file": "src/i18n/en.json",
    "text": "Save the document",
    "status": "pending",
    "author": "acme-app agent"
  }

$ corpus agent proposals
  {
    "proposals": [
      {
        "id": 1,
        "kind": "edit",
        "key": "editor.save",
        "file": "src/i18n/en.json",
        "text": "Save the document",
        "status": "pending",
        "author": "acme-app agent",
        "createdAt": "2026-09-23T16:33:29.970Z",
        "mine": true
      }
    ]
  }

```

`queue` takes `--lang` and `--type`; `propose` takes `--text` or `--remove`; `add` takes `--file` and `--text`, where the file is one of the sources `status` lists as writable. `withdraw` takes a proposal's id, and only one of the agent's own.

## Many operations, one process

Starting node per call costs more than the call, and a translation on a command line is a quoting problem waiting to happen. `--stdin` reads one JSON object per line and answers one per line, in order, through one process:

<!-- from: recorded/agent-stdin.txt -->
```text
$ corpus agent --stdin
  < {"op":"status"}
  < {"id":"d1","op":"draft","key":"editor.unsaved","language":"pt-PT","text":"Tem {count, plural, one {# alteração} many {# de alterações} other {# alterações}}"}
  < {"id":"bad","op":"draft","key":"editor.save","language":"pt-PT"}
  > {"op":"status","ok":true,"result":{"project":"acme-app","sourceLanguage":"en","languages":["en","pt-PT"],"strings":2,"lastPushAt":"2026-09-23T16:33:26.693Z","version":"v0.17.0","pendingProposals":1,"writableSources":["src/i18n/{lang}.json"],"progress":{"perLanguage":{"en":{"untranslated":0,"translated":2,"verified":0,"stale":0,"total":2},"pt-PT":{"untranslated":0,"translated":2,"verified":0,"stale":0,"total":2}},"perType":{"ui":{"en":{"untranslated":0,"translated":2,"verified":0,"stale":0,"total":2},"pt-PT":{"untranslated":0,"translated":2,"verified":0,"stale":0,"total":2}}}}}}
  > {"id":"d1","op":"draft","ok":true,"result":{"key":"editor.unsaved","language":"pt-PT","state":"translated","text":"Tem {count, plural, one {# alteração} many {# de alterações} other {# alterações}}","actor":"acme-app agent"}}
  > {"id":"bad","op":"draft","ok":false,"error":"bad-line","message":"text is missing or not a string"}
```

`op` is `queue`, `string`, `draft`, `propose`, `remove`, `add`, `proposals`, `withdraw` or `status`. The other fields are that operation's arguments by name: `queue` takes `queue` and optionally `language` and `type`; `string` takes `key`; `draft` takes `key`, `language` and `text`; `propose` takes `key` and `text`; `remove` takes `key`; `add` takes `key`, `file` and `text`; `withdraw` takes `proposal`, because `id` is already the line's own.

An `id` you send is echoed back, which is how a batch's answers are matched to its lines when they are read out of order.

An answer is `{"id", "op", "ok": true, "result"}` or `{"id", "op", "ok": false, "error", "message"}`. A line that is not an operation answers `bad-line`, as the third line above does; a server that cannot be reached answers `unreachable`. The process exits 1 when any line failed, and the other lines are still answered: one bad line does not end the batch.

## Which to use

MCP if the agent has a client, because the handshake hands it the tool list and the rules without you writing a prompt. `corpus agent` for a shell script, a CI job, or an agent whose harness has no MCP support. There is no third thing underneath: both are the same HTTP API, and `corpus mcp` is thin.
