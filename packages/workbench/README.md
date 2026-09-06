# @corpus-tool/workbench

The web app of [Corpus](https://github.com/miguelaguiar01/corpus), a self-hosted translation workbench for games and apps whose text is structured. Install it beside `@corpus-tool/cli` in the repository whose text is translated and start it with `npx corpus workbench`; the CLI keeps the database and the instance secret under `.corpus/` and prints the URL.

```sh
npm install --save-dev @corpus-tool/cli @corpus-tool/workbench
npx corpus workbench
```

For a team, run the published container image instead, which is the same app at the same version. Both are documented in the [repository](https://github.com/miguelaguiar01/corpus). The `corpus-workbench` binary starts the app directly from `CORPUS_DB_PATH`, `CORPUS_INVITE_SECRET`, `PORT` and `HOSTNAME`. Node 22 or later.
