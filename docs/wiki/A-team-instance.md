Translators need a URL they can open, and `corpus workbench` does not give them one: it listens on localhost. For a team, run the published container image.

It is the same application at the same version, with its database on a volume.

## Start one

```sh
git clone https://github.com/miguelaguiar01/corpus.git
cd corpus
export CORPUS_INVITE_SECRET="$(openssl rand -hex 24)"
docker compose pull
docker compose up -d
```

Keep that secret: it is what admits people, and the compose file refuses to start without it.

<!-- from: ../../compose.yaml -->
```yaml
services:
  corpus:
    # The published image at a version (`docker compose pull`), or a
    # build from this checkout when the image is not present locally.
    image: ghcr.io/miguelaguiar01/corpus:${CORPUS_IMAGE_TAG:-latest}
    build:
      context: .
      args:
        # The build identity /api/health reports: a tag or commit from
        # `git describe`; "dev" when unset.
        CORPUS_VERSION: ${CORPUS_VERSION:-dev}
    ports:
      - "3000:3000"
    environment:
      # Set a long random value before first start.
      CORPUS_INVITE_SECRET: ${CORPUS_INVITE_SECRET:?set CORPUS_INVITE_SECRET}
    volumes:
      - corpus-data:/data
    restart: unless-stopped

volumes:
  corpus-data:
```

`CORPUS_IMAGE_TAG` pins a version, written the way the image is tagged, without the release tag's leading `v`: `0.16.0`. `latest` is the default and is rarely what a team wants. Without the image, `docker compose up -d --build` builds it from the checkout.

## Two things before you expose it

**Mount a directory, never a single file.** SQLite runs in write-ahead mode and keeps `corpus.db-wal` and `corpus.db-shm` beside the database. A bind mount of one file gets you a database that cannot write.

**Put it behind HTTPS.** The session cookie is marked `Secure` for any host other than localhost, so over plain HTTP from another machine people cannot stay signed in. Behind a reverse proxy, set `CORPUS_PUBLIC_URL` to the public origin so the sign-in redirect names it rather than the proxy's internal host, and let the proxy pass a request body of at least 128 MB: a push carries the repository's translations, gzipped, and nginx's default `client_max_body_size` is 1 MB, whose `413` looks exactly like Corpus's own cap from the CLI (Caddy has no default limit).

## The environment

| Variable | What it is |
|---|---|
| `CORPUS_INVITE_SECRET` | Required. What admits new people. Long and random. |
| `CORPUS_PUBLIC_URL` | The public origin, behind a proxy. |
| `CORPUS_DB_PATH` | Where the database lives. `/data/corpus.db` in the image. |
| `PORT` | What it listens on. `3000`. |

`/api/health` reports the build it is running, so an instance is traceable to a commit without signing in:

```sh
curl -s https://corpus.example/api/health
```

<!-- from: recorded/health.json -->
```json
{"status":"ok","version":"v0.19.0"}
```

## Creating the project

`corpus workbench` creates a project as it starts. Against a team instance the CLI does it with the instance secret, and prints the token once, alone on the last line so a script can capture it:

```sh
CORPUS_INVITE_SECRET=<the instance secret> npx corpus project create --name "Acme app"
```

It talks to the `server` your config names, so run it where that config is, or pass `--server <url>`.

Put that token in `CORPUS_TOKEN` in your CI, and in `.corpus/token` locally. `npx corpus project rotate-token` replaces it, authenticating with the current one.

## Installing the CLI on release day

A package manager with a release-age policy holds back a version published inside its window, and the three write it differently: pnpm's `minimumReleaseAge` in `pnpm-workspace.yaml`, yarn's `npmMinimalAgeGate` in `.yarnrc.yml`, npm's `min-release-age` in `.npmrc`. Yarn 4.18 holds one back with no gate configured at all, saying `All versions satisfying "0.17.0" are quarantined`; `YARN_NPM_MINIMAL_AGE_GATE=0` for one install gets through. npm says `No matching version found for @corpus-tool/cli@0.17.0 with a date before <date>`; `--min-release-age=0` for one install. Each has an allow list for the packages a team trusts on release day: `minimumReleaseAgeExclude`, `npmPreapprovedPackages` and `min-release-age-exclude[]`, where `@corpus-tool/cli` and `@corpus-tool/workbench` are worth naming once.

Yarn and npm refuse the install outright. pnpm installs the fresh version and writes the exclusion into `pnpm-workspace.yaml` itself, pinned to that version and saying so, unless `minimumReleaseAgeStrict` is on, when it asks first and fails where there is no terminal to ask. Otherwise install the previous release, or wait the window out.

Two more walls met on real repositories. pnpm 11 with `verifyDepsBeforeRun` set (Immich has `install`) stops `pnpm corpus …` before Corpus runs when a build script was ignored, as `better-sqlite3`'s is unless approved; `pnpm exec corpus` and `node_modules/.bin/corpus` run it, and the prebuilt binary serves. And a repository whose own tree is heavy (Documenso's is 2 GB and was still installing when it was stopped after eleven minutes) can try Corpus without installing anything into it: `npx --package=@corpus-tool/cli@<version> --package=@corpus-tool/workbench@<version> corpus <command>` runs both from the npm cache, `corpus workbench` finds the workbench beside the CLI, and the config has to be a plain module, `corpus.config.mjs` exporting the object, since `defineCorpus` is not in the repository to import.

## How much memory

An idle instance holds about 110 MiB. A push costs memory while it runs and gives most of it back: Bitwarden's first push, 8,617 strings with 316,203 translations in 67 languages (a 48 MiB body, 586,000 rows), returns with about 340 MiB resident and settles near 160 MiB, and an unchanged push of it runs at about 560 MiB and settles near 210 MiB. Give a container for a project that size 1 GiB; a few thousand strings in a handful of languages need a fraction of it. The database of that project is about 85 MiB, with a write-ahead log of the same size until SQLite checkpoints it.

## Backups

The volume is the instance. Stop the container, copy the whole `/data` directory, start it again. Copying `corpus.db` alone from a running container gets you a database missing whatever is still in the write-ahead log.

## Upgrading

Pull the new tag and recreate the container:

```sh
CORPUS_IMAGE_TAG=0.16.0 docker compose pull
CORPUS_IMAGE_TAG=0.16.0 docker compose up -d
```

Migrations run at startup. Upgrade the CLI to the same version at the same time: the two are released together and a push carries what the instance expects.

## What is not here

There is no user directory, no single sign-on, and no per-project permissions. Everyone on the instance sees every project; maintainers verify and see the settings page, and everyone else translates. If that is too little, put it behind something that already knows who your people are, such as an identity-aware proxy, and treat the invite secret as the second lock rather than the first.
