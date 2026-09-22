`corpus workbench` starts an instance from your repository: the web app, its database, and the project your config declares.

```sh
npx corpus workbench
```

It needs `@corpus-tool/workbench` installed beside the CLI. Both packages always share a version.

## What it starts

```
Corpus workbench 0.16.0 is running at http://localhost:3000
  database  .corpus/corpus.db
  secret    a101b74f13e7b92de77912d782256645adbd6713f5d43d9d  (join with it once; it is in .corpus/secret)
  token     written to .corpus/token (project acme-app created)
  stop      Ctrl-C
```

Three things now exist under `.corpus/`, which `init` and `workbench` both add to your `.gitignore`, creating the file when there is none:

- **`corpus.db`**, the database, with `corpus.db-wal` and `corpus.db-shm` beside it while it runs. SQLite in write-ahead mode keeps all three, which matters when you copy them.
- **`secret`**, the instance secret. Anyone with it can join.
- **`token`**, the project token. Everything that works on the project uses it: `push`, `pull`, `status`, `corpus agent` and `corpus mcp`. `CORPUS_TOKEN` is read first, which is how CI passes it.

The first run creates the project your config names and writes its token. Later runs see the token and skip the step; `--no-provision` skips it too.

## The flags

| Flag | What it does |
|---|---|
| `--port <n>` | Listen elsewhere. `3000` by default. |
| `--db <path>` | Use a database somewhere else, which is how you run an instance from a directory that is not the repository. |
| `--open` | Open a browser at it. |
| `--no-provision` | Do not create or look for a project. |

## Joining

Open the URL and join with the secret, a display name and a password of at least eight characters. **The first person to join is the maintainer.** After that, anyone with the secret can join, and they sign in with their name and password rather than the secret.

There is no email and no self-service recovery: a maintainer resets a password from the settings page, which ends that person's sessions and shows a temporary password once.

A maintainer can make other people maintainers. Maintainers are the ones who can verify a translation and see the settings page.

## Who can reach it

`corpus workbench` listens on localhost. A translator on another machine cannot reach it, and that is the point: it is a development instance.

To let other people in, run the container image instead, which [A team instance](A-team-instance) covers. Do not expose the workbench with a tunnel and call it done: the session cookie is marked `Secure` for any host that is not loopback, so over plain HTTP from another machine the browser drops it and nobody stays signed in.

## Backing it up

Stop the instance, then copy all three files:

```sh
cp .corpus/corpus.db .corpus/corpus.db-wal .corpus/corpus.db-shm /somewhere/safe/
```

Copying `corpus.db` alone while it runs gets you a database missing whatever is still in the write-ahead log, which on a busy instance is most of it.

## Moving it

The database is the instance. To move one, copy those files and point `--db` at them:

```sh
npx corpus workbench --db /srv/corpus/corpus.db
```

Accounts, projects, translations and history are all in the database. The secret is per directory and the new one gets its own. The token does not come back on its own: the project already exists, so the start says so and asks you to rotate its token on the project's settings page and save it to `.corpus/token`.

## Upgrading

`npm update @corpus-tool/cli @corpus-tool/workbench` and start it again. Migrations run at startup, and the boot log names the database it opened. Nothing stops you putting an older version back and nothing makes it work: the migrations only go forward, and there is no check that would tell you.
