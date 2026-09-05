# @corpus-tool/cli

The `corpus` command for [Corpus](https://github.com/miguelaguiar01/corpus), a self-hosted translation workbench for games and apps whose text is structured. The CLI runs inside the repository whose text is translated: `corpus init` writes the config, `corpus push` uploads the repository's text to a Corpus instance, `corpus pull` writes verified translations back, and `corpus check` lints for user-facing literals outside declared sources.

```sh
npm install --save-dev @corpus-tool/cli
npx corpus init --project my-game --source en --languages en,pt-PT \
  --messages "src/i18n/{lang}.json" --server https://corpus.example
export CORPUS_TOKEN=<the project's push token>
npx corpus push
npx corpus pull
```

`push` and `pull` execute the repository's own `corpus.config.ts` and any `exec` commands it declares, by design: run them only in repositories you trust, as you would their build scripts. Node 22 or later.

The full guide, the design spec, and the changelog live in the [repository](https://github.com/miguelaguiar01/corpus).
