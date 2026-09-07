# @corpus-tool/cli

The `corpus` command for [Corpus](https://github.com/miguelaguiar01/corpus), a self-hosted translation workbench for games and apps whose text is structured. The CLI runs inside the repository whose text is translated: `corpus init` writes the config, `corpus workbench` starts an instance from the companion package and creates the project, `corpus push` uploads the repository's text, `corpus status` shows how far each language is, `corpus pull` writes verified translations back, and `corpus validate` and `corpus check` keep the repository honest offline.

```sh
npm install --save-dev @corpus-tool/cli @corpus-tool/workbench
npx corpus init --project my-game --source en --languages en,pt-PT \
  --messages "src/i18n/{lang}.json" --server http://localhost:3000
npx corpus workbench      # starts the instance, creates the project, writes .corpus/token
npx corpus push
npx corpus pull
```

Against a team's instance, `CORPUS_INVITE_SECRET=<secret> npx corpus project create` prints the project's token once, for `CORPUS_TOKEN` or `.corpus/token`. `push`, `pull` and `validate` execute the repository's own `corpus.config.ts` and any `exec` commands it declares, by design: run them only in repositories you trust, as you would their build scripts. Node 22 or later.

The full guide, the design spec, and the changelog live in the [repository](https://github.com/miguelaguiar01/corpus).
