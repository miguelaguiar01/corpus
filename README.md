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

To reach the instance from other devices, put it behind HTTPS (any
reverse proxy or a PaaS like Coolify works): the session cookie is
marked `Secure` in production, so browsers won't send it over plain
http except on localhost.

With Docker Compose (or a PaaS like Coolify that reads `compose.yaml`):

```sh
CORPUS_INVITE_SECRET="$(openssl rand -hex 24)" docker compose up -d
```

## Configuration

Environment variables are documented in [`.env.example`](.env.example).
The SQLite database file location is set with `CORPUS_DB_PATH` (default
`./data/corpus.db`); migrations apply automatically on first database
access.

> Under construction (milestone M0). The real README — with screenshots of
> Corpus translating Corpus — lands with M4.
