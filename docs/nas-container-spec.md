# NAS Container -- Design Spec

**Status:** Locked
**Target:** v3
**Date:** 2026-09-02

## Problem

`npm run pipeline` runs on a laptop that reaches the NAS only over SMB-over-VPN.
Extraction + classification happen locally, then the filtered output is written
across the VPN -- ~6 hours per release on bad wifi (`feat/resilient-nas-write`
made that resumable, not fast). Downloads are ~5-12 GB per release and also cross
the VPN.

Run the pipeline **on the QNAP** instead: `3D Files` and the download staging
folder are local paths, the write is local-disk, and the ~6-hour transfer
disappears. Mirrors the pattern already proven for `3dModelsBrowser`
(`docs/nas-container-spec.md` in that repo).

## Not in scope

- **Download automation** -- anti-bot on the creator sites killed every Puppeteer
  approach. Downloads stay manual; the user grabs the ZIPs/RARs and places them
  in a NAS folder (downloaded directly on the NAS where possible, else copied
  over the VPN once as a plain file copy).
- Changing what `cli.ts` / `cli-download.ts` / `cli-sync.ts` do. `syncToNas`
  already falls back to the resilient tree-walk when `robocopy` is absent
  (non-Windows) -- on local disk that's fast. **No `src/` changes.**
- The laptop `npm run pipeline` path -- kept as a fallback (VPN write code is a
  documented future teardown once the container is the default).

## Environment

- **Host:** QNAP TVS-872XT -- x86_64, Container Station, `docker compose` over SSH.
- `3D Files` and a `downloads` folder are **shares on the QNAP** (local FS paths,
  e.g. `/share/CACHEDEV1_DATA/<share>/...` -- exact paths set via env).
- Owner is the only committer. Force-push to `master` acceptable
  (`--force-with-lease`).
- Repo is public. `data/pipeline.db` is committed there already.

## Design

### `docker/` -- self-contained

Build context is `docker/` itself, so **only that folder needs to reach the
QNAP** (copy it to the docker-compose share, or keep it as a sparse checkout and
`git pull`). The container clones the repo at runtime.

```
docker/
  Dockerfile
  compose.nas.yml
  pipeline-run.sh          entrypoint
  lib/git-sync.sh          the git bits, split out for testing
  .dockerignore
```

`.gitattributes` at the repo root forces LF on `docker/**/*.sh` (a CRLF checkout
on Windows would break the shebang in the Linux container).

### Container

- `node:22-slim` + `git` + `ca-certificates` + `tini`.
- `npm ci` (full -- `tsx` is a devDependency; the CLIs run `.ts` directly).
- Volumes:
  - `pipeline-repo:/repo` -- the git checkout, persists between runs
    (incremental `git fetch` + `reset`, not a fresh clone)
  - `pipeline-npm:/root/.npm` -- npm cache
  - `pipeline-work:/work` -- `TMPDIR=/work/tmp` (archive extraction, ~12 GB) and
    `STAGING_PATH=/work/staging` (the organised tree before the local copy; kept
    so `sync` can resume an interrupted run)
- Bind mounts:
  - `${NAS_3DFILES}:/nas/3D Files` **rw** -- the pipeline writes here
  - `${NAS_DOWNLOADS}:/downloads` **ro** -- where the user drops downloads
- `stdin_open: true`, `tty: true` -- `docker compose run` attaches a TTY so the
  `inquirer` tagging prompts work.
- One-off task: `docker compose -f compose.nas.yml run --rm pipeline`. Nothing
  runs between uses; `--rm` deletes the container on exit. Only the image and the
  three small volumes persist.

### Entrypoint (`pipeline-run.sh`)

```
CMD = $1 (default "pipeline"; also "download", "sync")

# git
clone /repo if empty, else set-url origin
git fetch origin $BRANCH ; git reset --hard origin/$BRANCH     # take remote as truth
# (the container never leaves uncommitted work -- it commits pipeline.db at the
#  end of every pipeline/download run -- so a hard reset is always safe)

npm ci

npm run "$CMD"          # interactive for pipeline/download

# for pipeline/download: commit + push the tracker DB (no rewind -- pipeline.db
# is cumulative state, not a regenerable artifact)
if CMD != sync:
  git add data/pipeline.db
  git commit -m "chore(tracker): <CMD> $(date -u +%FT%RZ)"   if changed
  git push --force-with-lease origin $BRANCH
```

Exit code is the CLI's; the DB commit runs even on a non-zero exit (it is a
no-op when nothing changed).

### Credentials

GitHub **fine-grained PAT**, this repo only, `contents: write`. Passed as
`GH_TOKEN` env (never committed). `git` remote built as
`https://x-access-token:${GH_TOKEN}@github.com/${GH_REPO}.git`.

### Workflow

One-time: `cp .env.example .env` in the deploy folder, fill in `GH_TOKEN` and the
two share paths, `docker compose -f compose.nas.yml build`.

1. Download the release's archives, directly on the NAS where possible (QNAP
   Download Station from the signed URLs), else download on the PC and copy to
   the NAS `downloads` share once.
2. `ssh` to the QNAP, `cd` to the deploy folder.
3. `docker compose -f compose.nas.yml run --rm pipeline` (compose reads `.env`).
4. Prompt: archive path = `/downloads/<release>`.
5. Tag interactively.
6. Container writes to `/nas/3D Files/<subscription>/`, then commits + pushes
   `data/pipeline.db`.

Credentials/config live in `.env` (gitignored); `.env.example` is committed.

`docker compose ... run --rm pipeline download` and `... pipeline sync` for the
tracker CLI and a sync-only resume.

## Local dev loop

Edit `src/` on the laptop -> `git push origin master` -> next
`docker compose run` does `git fetch` + `reset --hard origin/master` and picks it
up. No rebuild needed for `src/` changes; only a `docker/Dockerfile` or a
`package.json` dependency change needs `docker compose build`.

## Testing

- `tests/docker/git-sync.test.ts` -- sources `docker/lib/git-sync.sh` and
  exercises it against a throwaway local bare repo: clone-or-reuse, hard-reset to
  remote, `commit_db` skips a no-op, `commit_db` pushes a real change,
  `--force-with-lease`. In `npm test`.
- `bash -n docker/pipeline-run.sh docker/lib/git-sync.sh` -- syntax.
- Local full dry run: `docker compose build`, then
  `docker compose run --rm pipeline` against a small fixture tree in
  `/downloads` and a `file://` bare repo for the remote -- clone -> `npm ci` ->
  classify -> (skip interactive with a piped answer file, or a tiny profile) ->
  local write -> one `chore(tracker)` commit pushed.

## Build order

1. `docs/nas-container-spec.md` (this) -- Locked.
2. `.gitattributes` (LF for `docker/**/*.sh`).
3. `docker/lib/git-sync.sh` + `tests/docker/git-sync.test.ts` -- test first.
4. `docker/pipeline-run.sh`, `docker/Dockerfile`, `docker/compose.nas.yml`,
   `docker/.dockerignore`.
5. Local `docker build` + dry run against a fixture + `file://` remote.
6. CLAUDE.md: components table (the `docker/` folder), a "Running on the NAS"
   section, `.env` note (container uses env, not the file).
7. Deploy to the QNAP: set the share paths, first real run. **This run doubles
   as the DM Stash live-import gate.**

## Open questions

| # | Question | Leaning |
|---|---|---|
| Q1 | Combined `compose.nas.yml` with the browser, or a separate one per repo? | Separate per repo -- they're maintained independently in different folders; `git-sync.sh` is copied, not shared. A combined file is a small later merge. |
| Q2 | `pipeline.db` commit: one commit per run (audit log), or the browser's one-moving-snapshot-commit? | One per run. The DB is cumulative; rewinding past the last commit would drop the prior run's rows. The history is a useful "when was each release processed" log; binary diffs are tiny. |
| Q3 | `docker compose build` cadence -- does the entrypoint `npm ci` every run (slow-ish first time, cached after via the npm volume)? | Yes, every run, cached. Matches the browser. A lockfile change is picked up automatically. |
