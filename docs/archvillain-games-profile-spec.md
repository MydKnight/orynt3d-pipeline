# Archvillain Games Profile — Design Spec

**Status:** Implemented
**Target:** v3
**Date:** 2026-08-29

## Problem

Archvillain Games is the fourth pipeline profile. Its downloads differ from the existing three in two ways:

1. **Archives are RAR, not ZIP.** The extractor only handles ZIP today.
2. **One archive per model, manually assembled into a folder by the user** — the same "folder of archives" shape Rescale already uses, but RAR.

## Input structure

The user manually downloads the **presupported** archive for each model in a month's release and drops them all in one folder named for the release:

```
Empire of Sands - Vault of the Scarab God/        ← folder name = pack / release name
  Khepresh - The Vault Father - Presupported.rar
  Scarab Spawn - Presupported.rar
  Sebau Worm - Presupported.rar
  Vaultsworn Scarab - Presupported.rar
  Vaultsworn Zealot - Presupported.rar
```

Each RAR contains exactly one wrapper folder (same name as the RAR, minus `.rar`) holding a **flat** file list:

```
Vaultsworn Zealot - Presupported/
  EoSVS.IndPres.VaultswornZealot01.jpg      ← render, one per pose (numeric suffix = pose)
  EoSVS.IndPres.VaultswornZealot02.jpg
  ...
  LYS_Zealot_01_supported.lys               ← Lychee project files — SKIP
  STL_Zealot_01_supported.stl               ← figure, pose 01
  STL_Zealot_01_base_scenic_supported.stl   ← scenic base, pose 01
  STL_Zealot_01_base_standard_supported.stl ← standard base, pose 01
  STL_Zealot_02_supported.stl
  ...
```

### Two file patterns

- **Multi-pose** (Zealot, Scarab, Spawn, Worm): STL names carry a pose number — `STL_{Short}_0N_..._supported.stl` for N = 01..04. Each pose = 3 STLs (figure + scenic base + standard base). One render image per pose, name ending `{Short}0N.jpg`.
- **Kitbash centerpiece** (Khepresh): STL names carry component names, no pose number — `body`, `head`, `arm_l`, `arm_r`, `legs`, `wing_l`, `wing_r`, `bug`, `base_standard`, plus `HOLLOWED_` variants of some parts. Images are not pose-numbered (`Khepresh.jpg`, `Khepresh.CloseUp.jpg`).

### Two archive shapes

- **Individual-model archive** (`{Model} - Presupported.rar`): the wrapper folder holds model files directly.
- **Compilation archive** (`Archvillain Games - Archvillain {Society|Bestiary} Vol. {N} - Presupported.rar`): the wrapper folder holds **one subfolder per model** (`Hoardlurk - Presupported/`, `Khalef - Vault Guardian - Presupported/`, …), each with its own flat files. Society and Bestiary are separately-versioned reprint lines that ship alongside the themed pack each month; the user drops all three into the one month folder (see "one folder" decision below).

### Provenance

Society/Bestiary reprints carry an `AVS` / `AVB` marker in their render filenames (`EoSVS.IndPres.AVS.Khalef.jpg`). A model whose render carries `AVS` gets `userTags: ['society']`, `AVB` → `['bestiary']`, core themed models get no provenance tag. Lets "all Society heroes across every month" be a tag query without splitting folders.

Note the STL "short name" (`Zealot`) differs from the image short name (`VaultswornZealot`) — pose matching is on the **numeric suffix only**, not the short name.

## Design decisions

### 1. Each pose is its own model

Matches the Rescale precedent. `Vaultsworn Zealot` with 4 poses produces 4 `ClassifiedModel`s: `Vaultsworn Zealot 1` .. `Vaultsworn Zealot 4` (leading zero stripped). Each gets its 3 STLs and its one render image.

A kitbash model with no pose numbers (Khepresh) produces **one** `ClassifiedModel` named for the archive (`Khepresh - The Vault Father`) with all part STLs and all images.

**Rejected:** one model per RAR with all poses bundled. The user prints and catalogues poses individually.

### 2. Keep every `STL_*.stl`, skip `.lys`

Figure + both base options + `HOLLOWED_` variants all come across. `.lys` (Lychee) and `.jpg` are not model files (images handled separately).

### 3. RAR via `node-unrar-js`

Pure WASM, no native compilation — consistent with the `better-sqlite3` ban. `extractor.ts` gains RAR handling alongside ZIP, for both a single archive and a folder of archives. `extractZip` is renamed `extractArchive`.

### 4. Per-model image list

New optional field on `ClassifiedModel`:

```ts
/** Explicit image files to copy, when one source folder holds images for several models. */
imageFiles?: string[]
```

The reorganizer, when `profile.includesImages` is true, copies `model.imageFiles` if set, otherwise falls back to scanning `imageSourceFolder ?? sourceFolder` (unchanged behaviour for the other profiles).

### 5. Category is always prompted

`categoryMappings = { Models: { options: ['hero', 'npc', 'monster', 'terrain', 'prop'] } }`. Archvillain releases span all of these and the raw download gives no category signal, so every model prompts.

### 6. Fixed values

- `scale`: `'32mm'` (hardcoded — Archvillain is one scale)
- `supportType`: `'ReadyToSlice'` (all presupported STLs)
- `includesImages`: `true`
- `filter`: `{ include: ['ReadyToSlice'], includeFDM: false }`
- `formatPackFolder(pack)`: returns `pack` unchanged
- `formatModelFolder(name)`: returns `name` unchanged

## classify() algorithm

`classify()` returns `{ models, warnings }` — `warnings` lists folders it
deliberately did not turn into models. `cli.ts` prints them and asks before
writing (same gate as unclassified files).

### Structure walk — shape-agnostic

No per-release structure detection. One recursive rule finds the folders that
hold model files, whatever the wrapper nesting (individual RAR → 1 wrapper;
compilation RAR → 1–2 wrappers then one folder per model; old flat imports →
release/model):

```
modelFolders(dir):
  hasModelFiles  = dir has an *.stl / *.3mf directly
  modelSubdirs   = sub-folders that contain a model file at any depth

  hasModelFiles AND modelSubdirs  → warn "model files and also sub-folders …", skip
  hasModelFiles                   → dir is a model folder
  modelSubdirs                    → recurse into each
  neither, but has sub-folders    → warn "sub-folders but none contain model files"
  neither                         → warn "no model files"
```

### modelsFromFolder(folder)

```
stls   = *.stl / *.3mf   (excludes LYS_*.lys)
images = *.jpg/.jpeg/.png/.webp
base   = folder name minus trailing " - Presupported"
tag    = 'society' if an image name contains .AVS. ; 'bestiary' if .AVB. ; else none

poseOf(f) = zero-padded two-digit token — trailing /(\d{2})$/ (images) or
            segment /_(\d{2})(?=[_.])/ (STLs), else null. Exactly two digits, so a
            stray single digit (_v2, goat_1, CloseUp2) is not a pose.

numbered   = stls with a pose token
unNumbered = stls without one
parts      = unNumbered that are NOT a display base (name lacks "base")

poses ≥ 2 AND parts.length < numbered.length  → multi-pose:
    one ClassifiedModel per pose token n:
      modelName  = `${base} ${parseInt(n)}`
      files      = that pose's numbered stls  +  ALL unNumbered stls (shared bases)
      imageFiles = images whose token == n    +  images with no token (group render)
      userTags   = [tag] or undefined

otherwise → one model (single pose, or a kitbash centerpiece whose few numbered
    part-options don't make it N poses): all stls, all images, [tag].
```

The `parts.length < numbered.length` guard keeps a centerpiece assembled from many
named parts (Khazrai: 3 numbered among ~45; Polystixis: `body_01`/`body_02` among
~20) as one model, while `Oceanvoid Scion` (`body_01`, `body_02` + two shared
bases → 0 parts, 2 numbered) splits into two, each carrying both bases.

## Extractor changes

- Rename `extractZip` → `extractArchive`; update `cli.ts`.
- Single `.rar` input → extract to temp dir (mirror single-ZIP path).
- Folder containing `.rar` files → extract each into its own subdir (mirror folder-of-ZIPs path).
- A folder may not mix `.zip` and `.rar`; if it has `.rar`, treat as RAR batch.
- RAR extraction failure: same message pattern as ZIP ("corrupt or incomplete — extract manually or re-download").

## Required one-time NAS cleanup (user)

The existing Orynt folder is misspelled `Archvillian Games` and holds 8 old manual imports. The profile `name` is `Archvillain Games` (correct — matches the `archvillaingames` tracker key). Before the first pipeline run:

1. Rename `\\NAS\3D Files\Archvillian Games` → `Archvillain Games`
2. Re-point the Orynt3D scan source to the renamed folder

New pipeline output then lands alongside the old manual imports under one correctly-named subscription.

## Build order

1. `imageFiles` field on `ClassifiedModel` + reorganizer support — Implemented 2026-08-29
2. `extractArchive` rename + RAR support (single + folder-of) — Implemented 2026-08-29 (extractor is I/O, exempt from unit tests; verified via functional run)
3. `tests/profiles/archvillain-games.test.ts` — 10 tests (pose parsing, name derivation, image/model file matching) — Implemented 2026-08-29
4. `src/profiles/archvillain-games.ts` — Implemented 2026-08-29
5. Register in `src/profiles/index.ts` — Implemented 2026-08-29
6. Functional run against `Empire of Sands - Vault of the Scarab God` sample — Verified 2026-08-29: with all 7 archives (5 individual + Society Vol. LXII + Bestiary Vol. XXXVI) → 23 models: 17 from the themed pack (Khepresh kitbash / 11 STLs incl. HOLLOWED / 2 images; 4×4 poses / 3 STLs / 1 matched render) + 6 from the compilations (3 `bestiary`-tagged, 3 `society`-tagged)
7. CLAUDE.md profile section + components table row — Implemented 2026-08-29

NAS folder renamed + Empire of Sands imported (23 models) 2026-08-30.

### Revision — 2026-08-31 (`fix/archvillain-classify`)

High Seas - Tides of Madness surfaced two structures the first cut didn't handle:
its Society RAR has a **doubled wrapper folder**, and `Oceanvoid Scion` is
multi-pose with **shared bases**. Rewrote the structure walk to be recursive and
shape-agnostic (descend through any wrapper depth), made un-numbered STLs shared
across poses, added the kitbash guard, and had `classify()` return `warnings`
that the CLI gates on. `tests/profiles/archvillain-structure.test.ts` locks in
the Empire of Sands shape, the High Seas doubled-wrapper shape, shared-base
splitting, the kitbash guard, and both fail-loud cases. Verified against the real
High Seas download: 24 models (was 21), 0 warnings.

## Out of scope

- Download automation (Archvillain site, manual downloads stay manual)
- Reprocessing the 8 old manual imports (stay as-is, per pragmatic policy)
- `.7z` or other archive formats
