# Corpus

Corpus is a self-hosted, lightweight translation workbench for games and
apps whose text is *structured* — strings that carry metadata, placeholders,
relations to game objects, and rendering context that flat key-value TMS
tools can't represent well.

Text lives in each project's git repository; Corpus is an editing surface,
never the source of truth. A CLI (`corpus push` / `corpus pull`) syncs the
two, and the round-trip is provably lossless. Corpus translates its own UI
with itself — the standing demo and integration test.

- **[`docs/corpus-design.md`](docs/corpus-design.md)** — the binding design
  spec. Read it before writing any code.
- **[`AGENTS.md`](AGENTS.md)** — workflow, non-negotiables, and the board.
- **[`docs/DECISIONS.md`](docs/DECISIONS.md)** — architecture decisions log.

## Local development

The same app runs as a plain local process, no Docker involved. You need
Node 22 (see `.nvmrc`) and npm:

```sh
git clone https://github.com/miguelaguiar01/corpus.git
cd corpus
npm install
cp apps/web/.env.example apps/web/.env   # then set CORPUS_INVITE_SECRET
npm run dev
```

Open http://localhost:3000, enter the invite secret from your `.env`
and a display name. The first user becomes the instance maintainer. The
database is created on first start at `apps/web/data/corpus.db` and is
gitignored; delete it to start over. `bin/gate` runs what CI runs
(typecheck, lint, tests, `corpus check`); `bin/container-smoke` builds
and boots the production image locally if you have Docker.

To push a project into your local instance, create it in the UI (you get
a push token once), then run the CLI from this repository against the
project's `corpus.config.ts` (the CLI is not published yet; `corpus` is
`npx tsx packages/cli/src/bin.ts` for now):

```sh
cd /path/to/your-project
CORPUS_SERVER=http://localhost:3000 CORPUS_TOKEN=<token> \
  npx tsx /path/to/corpus/packages/cli/src/bin.ts push
```

## Self-hosting

Corpus ships as a single container with its SQLite database on a
volume. You need Docker and nothing else:

```sh
git clone https://github.com/miguelaguiar01/corpus.git
cd corpus
docker build -t corpus .
docker run -d --name corpus \
  -p 3000:3000 \
  -e CORPUS_INVITE_SECRET="$(openssl rand -hex 24)" \
  -v corpus-data:/data \
  corpus
```

Then open http://localhost:3000 — you'll be asked for the invite secret
you just set and a display name. The first person to join becomes the
instance maintainer. All data lives in the `corpus-data` volume; the
container itself is disposable.

Mount a **directory**, never a single file: SQLite runs in WAL mode and
keeps `-wal` and `-shm` files next to the database, so a bind mount of
`corpus.db` alone would break writes.

To reach the instance from other devices, put it behind HTTPS (any
reverse proxy or a PaaS like Coolify works): the session cookie is
marked `Secure` in production, so browsers won't send it over plain
http except on localhost.

With Docker Compose (or a PaaS like Coolify that reads `compose.yaml`):

```sh
CORPUS_INVITE_SECRET="$(openssl rand -hex 24)" docker compose up -d
```

## Configuration

Environment variables are documented in
[`apps/web/.env.example`](apps/web/.env.example). Local and container
runs share one code path; only these differ by environment:

| Variable | Local default | Container |
| --- | --- | --- |
| `CORPUS_INVITE_SECRET` | required, from `apps/web/.env` | `-e` at `docker run` |
| `CORPUS_DB_PATH` | `apps/web/data/corpus.db` | `/data/corpus.db` on the volume |
| `PORT` | `3000` | `3000` |

Migrations apply automatically when the app starts, and the boot log
names the database file it opened.

> Under construction (milestone M0). The real README — with screenshots of
> Corpus translating Corpus — lands with M4.
