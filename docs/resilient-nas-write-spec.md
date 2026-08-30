# Resilient NAS Write — Design Spec

**Status:** Draft
**Target:** v3
**Date:** 2026-08-30

## Problem

`reorganize()` copies every model file straight to the NAS with `fs-extra.copy`. Over a home LAN this is fine. Over a VPN from outside the network — the normal case — it is fragile:

- **No retry.** A 2-second blip throws; that model is logged as an error and abandoned.
- **Partial files are trusted.** `copy(..., { overwrite: false })` skips a destination that exists without checking it is complete. A file truncated by a mid-copy drop stays truncated on every re-run.
- **A single file's failure abandons the whole model.** The 2026-08-29 Empire of Sands run: `Vaultsworn Scarab 4` copied one of three STLs, then the post-copy `chmod` failed and the model was abandoned with no config.
- **`fs-extra.copy` runs `chmod` after every file** — a pointless extra SMB round-trip (share permissions are the server's, not the file's) and its own failure mode.
- **A drop means re-running the whole pipeline** — re-extract ~4 GB of archives, re-walk the tagging TUI — even though only the transfer failed.
- **No progress.** "Writing to NAS..." is silent for the length of a multi-GB copy.

A single monthly Archvillain release is ~12 GB across 23 models. A VPN drop 45 minutes into that should not cost the 45 minutes.

## Design decisions

### 1. Stage locally, then sync — two separated concerns

`reorganize()` writes the organized tree to a **local staging directory**, not the NAS. A separate `syncToNas()` step transfers staging → NAS.

- **Reorganize** becomes local-disk-only: fast, deterministic, crash-safe, and unit-testable (it is currently exempt precisely because it is NAS-bound).
- **Sync** is the one flaky step, and it is handled by a tool built for flaky links.

*Rejected:* resilient copy straight to the NAS with a retry loop. Simpler, but it cannot resume a partly-transferred large file, and every re-run re-walks the whole tree. Staging + a restartable sync is strictly better for hour-long transfers.

### 2. Sync via `robocopy` restartable mode, with a fallback

```
robocopy <staging>\<subscription> <nas>\<subscription> /E /Z /R:10 /W:15 /NP /NFL /NDL /XF ~*.tmp
```

- `/Z` — **restartable mode**: resumes a partially-copied file at the byte it stopped
- `/R:10 /W:15` — retry each file 10×, 15 s apart (rides out a reconnect)
- `/E` — all subdirectories
- default file comparison is size + timestamp — an unchanged file is not re-sent, a truncated one is
- exit codes 0–7 are success variants (0 = nothing to do, 1 = files copied, 3 = copied + extras, …); ≥ 8 is a real failure

**Fallback** when `process.platform !== 'win32'` or `robocopy` is not on PATH: walk the staging tree with the resilient-copy primitive from decision 3. Same size-skip and retry semantics, no mid-file resume.

*Rejected:* `rclone`. Cross-platform and resumable, but a new dependency plus config. `robocopy` ships with Windows, which is where this runs. Revisit if the pipeline ever moves off Windows before it moves onto the NAS itself.

### 3. Resilient local-copy primitive

`reorganize()` (and the sync fallback) copy through:

```
resilientCopy(src, dest):
  if exists(dest) and size(dest) === size(src): return            # already there, trust size
  copy src -> dest + "~<rand>.tmp"    via fs.copyFile (no chmod)
  rename dest+".tmp" -> dest                                       # atomic; a crash leaves only .tmp
  on transient error (UNKNOWN, EBUSY, ECONNRESET, EPERM, EAI_AGAIN, ETIMEDOUT):
    retry up to 5×, backoff 1s → 2s → 4s → 8s → 16s
  non-transient error: throw
```

- **size match = skip** — same rule robocopy uses. Truncation always changes size, so partials are recopied; complete files are never re-sent.
- **`.tmp` + rename** — the destination file only ever exists complete. `/XF ~*.tmp` keeps stray temp files out of the NAS sync.
- **`fs.copyFile`, not `fs-extra.copy`** — drops the chmod round-trip entirely.

### 4. A file failure does not abandon its model; a model failure does not abandon the run

`reorganize()` already continues past a failed model. Extend it: within a model, a failed file is retried (decision 3); if it still fails, that file is recorded and the rest of the model's files still copy. The model's `config.orynt3d` is written only if all its files landed. The end-of-run report lists incomplete models file-by-file.

### 5. Config files

- **Model-level `config.orynt3d`** — written into staging, synced like any model file (it is always regenerated anyway).
- **Subscription- and pack-level `config.orynt3d`** — small, and "write once, never overwrite" (`writeConfigIfAbsent`). Written **directly to the NAS** through a retrying wrapper, checking the real destination for existence. Kept out of the robocopy set so a staged copy can never clobber a NAS config with manual edits.

### 6. Standalone re-sync

```
npm run sync
```

Runs `syncToNas()` alone against the last staging directory. This is the drop-recovery path: VPN dies mid-transfer → reconnect → `npm run sync` → robocopy resumes. No re-extract, no re-tag. Prompts for the subscription if more than one staging tree is present.

### 7. Staging directory lifecycle

- Location: `<STAGING_PATH>/.orynt-staging/<subscription>/` (`STAGING_PATH` env, already defined, defaults to the OS temp dir).
- **Not deleted on success by default** — it is the safety net and the `npm run sync` source. `reorganize()` prints its path; a `--clean-staging` flag (or a prompt after a verified sync) removes it.
- A re-run of the full pipeline reuses the staging dir: `resilientCopy`'s size-skip makes re-staging nearly free when it is already populated.

### 8. Progress reporting

- **Staging:** `[ 7/23] Vaultsworn Zealot 3` as each model starts (local, fast — a counter is enough).
- **Sync:** stream `robocopy`'s own output (it reports per-file and a summary). Wrap it with a one-line header — total files / total size from a pre-walk of staging — and a final `N files, X.X GB synced in Mm Ss`. The fallback path prints `X.X / Y.Y GB (NN%)` from a rolling-rate estimate.

## Architecture

```
cli.ts
  reorganize(models, profile, stagingRoot)      # local only — resilientCopy + model configs
      ↓  <STAGING_PATH>/.orynt-staging/<subscription>/...
  writeNasConfigs(profile, nasRoot)             # sub/pack configs direct to NAS, retrying, write-once
  syncToNas(stagingRoot, nasRoot, profile)      # robocopy /Z /R /W  (fallback: walk + resilientCopy)
      ↓
  \\NAS\3D Files\<subscription>\...
```

`reorganize()`'s signature changes from `(models, profile, nasRoot)` to `(models, profile, stagingRoot)`. `syncToNas` and `writeNasConfigs` are new. `src/pipeline/nas-sync.ts` holds the robocopy wrapper + fallback; `src/pipeline/resilient-copy.ts` holds the primitive.

## Acceptance tests

**#1 — the 2026-08-29 partial state (the reason this exists).** With the NAS holding 18 complete Empire of Sands models + `Vaultsworn Scarab 4` (1 of 3 STLs, no config) + no `Vaultsworn Zealot` folders:

- re-stage from the sample, run `syncToNas`
- **expect:** the 18 complete models and Scarab 4's one finished STL are not re-transferred (robocopy reports them skipped); the 2 missing Scarab 4 STLs + render + config are copied; `Vaultsworn Zealot 1–4` are created in full
- **expect:** final NAS state is all 23 models complete, and no `Vaultsworn Scarab 4` folder had to be deleted by hand

**#2 — mid-run kill.** Kill the process during `syncToNas`. Re-run `npm run sync`. Expect it to resume with no duplicate transfer and no truncated file left as final.

**#3 — `resilientCopy` unit tests** (temp dirs, no NAS): size-match skip; truncated-dest recopy; `.tmp` cleaned on success; `.tmp` left (not the real name) on simulated mid-copy crash; retry succeeds after N transient failures; non-transient error throws.

**#4 — config write-once survives staging.** A pack `config.orynt3d` already on the NAS with an extra tag is not overwritten by a pipeline re-run.

## Build order

1. `src/pipeline/resilient-copy.ts` + unit tests (acceptance #3)
2. `reorganize()` → local staging via `resilientCopy`; signature change; `[n/total]` progress
3. `writeNasConfigs()` — sub/pack configs direct to NAS, retrying
4. `src/pipeline/nas-sync.ts` — robocopy wrapper, exit-code handling, output passthrough; fallback walker
5. `cli.ts` wiring: stage → nas configs → sync; `--clean-staging`
6. `npm run sync` standalone entry (`src/cli-sync.ts`)
7. Acceptance #1 against the live partial state; #2; #4
8. CLAUDE.md — architecture section, components table, new scripts; move `session.ts`-style note about reorganizer being testable now that it is local

## Out of scope

- Checksums / content verification beyond size (truncation is the real failure mode; a full checksum pass means reading every file back over the VPN)
- Running the pipeline on the NAS (the eventual fix that removes the VPN entirely — tracked separately)
- Parallel / multi-stream transfer
- Resuming the *extraction* step (cheap to redo; the tagging session already resumes)
