Corpus has two ways in and no third. A person signs in; a project token authenticates a machine. There is no user directory, no single sign-on, and no per-project permissions ([§10](https://github.com/miguelaguiar01/corpus/blob/main/docs/corpus-design.md#10-users-and-access)).

## People

An account is a display name and a password of at least eight characters, hashed with scrypt in the instance's database. There is no email address anywhere, which also means there is no password reset link and no way to recover an account without a maintainer.

One **instance invite secret** admits people. `corpus workbench` generates one into `.corpus/secret` and prints it; a container takes it from `CORPUS_INVITE_SECRET`. Joining takes the secret, a name and a password. After that, signing in takes the name and password alone.

**The first person to join is a maintainer.** Everyone after them is not, until a maintainer says so.

A taken name is refused, with one exception: an account created before passwords existed has no hash, and the first join with that name claims it.

## The one flag

People have exactly one: `maintainer`. A maintainer verifies translations and sees the settings page; everyone else translates. Everyone on the instance sees every project either way.

Maintainers toggle the flag for other people, and for themselves: stepping down is allowed, except for the last maintainer, which is refused rather than leaving an instance nobody can verify in. Losing the flag ends that person's sessions, because what they can reach changed.

## Sessions

Sessions live in the database and last 90 days of disuse, renewed on use. Signing out ends the session on the server rather than only in the browser, and so does a password reset, and so does losing the maintainer flag.

The cookie is `HttpOnly` and `SameSite=Lax`, and `Secure` for any host that is not loopback. That is why a team instance needs HTTPS and a workbench on `http://localhost` does not: over plain HTTP from another machine the browser drops the cookie and nobody stays signed in.

## Resetting a password

A maintainer does it from the settings page. It ends that person's sessions and shows a temporary password once. Their next sign-in goes straight to choosing a new one, and nothing else is reachable until they have.

Write the temporary password down when it is shown. There is no second chance to read it.

## Project tokens

The CLI authenticates with a per-project bearer token, from `CORPUS_TOKEN` or `.corpus/token`, which is read second. `corpus workbench` writes it; `corpus project create` prints it once, alone on the last line.

The file Corpus writes is owner-only. What keeps it out of git is `.corpus/`, which `corpus init` and `corpus workbench` both add to `.gitignore`, creating the file when there is none — so a token you paste in by hand after `project create` is ignored too, though its permissions are then yours to set.

A token pushes, pulls, reads queues and strings, saves drafts and makes proposals. It cannot verify, cannot change settings, cannot touch users, and cannot sign in anywhere.

Rotate with `npx corpus project rotate-token`, which authenticates with the current one, or from the project's settings page. Rotation does not change the agent actor: the history stays attributed.

## The instance secret creates projects

`POST /api/projects` accepts the instance secret as a bearer token and returns the new project's token once, only its hash stored. That is what `corpus project create` calls.

It hands out no more than a new project's own token, which opens nothing that existed before — which is the reason the route can take the secret at all, given the secret is what every person on the instance was invited with. It is rate-limited like the join form.

## The agent actor

Every write through a project token is recorded as that project's **agent actor**: one user row per project, flagged `agent`, named `<slug> agent`, created with the project. Token rotation does not change it.

It never signs in. The join form refuses any name ending in ` agent`, no session is ever issued for it, and the reset and maintainer actions refuse it outright rather than only hiding it from the form.

## What this is not

There is no group, no role beyond the one flag, and no way to give somebody one project and not another. Everyone on the instance sees everything on it.

If that is too little, put the instance behind something that already knows who your people are — an identity-aware proxy — and treat the invite secret as the second lock rather than the first. The instance is meant to be safe without it, but it is not meant to replace it.
