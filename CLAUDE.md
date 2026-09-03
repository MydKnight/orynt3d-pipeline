# CLAUDE.md — orynt3d-pipeline

## Project Overview

A file processing pipeline that takes raw 3D model subscription downloads — ZIPs with inconsistent, creator-specific folder structures — and reorganizes them into the folder structure Orynt3D expects for scanning and cataloguing. Each subscription has a "profile" that teaches the pipeline how to read that creator's folder conventions and map them to the normalized output structure.

**Where this fits:**
```
[Subscription ZIPs in Downloads]
         ↓
  orynt3d-pipeline        ← this project
         ↓
  \\NAS\3D Files\{Subscription}\{Pack}\    ← Orynt3D scans this
         ↓
  3dModelsBrowser (web gallery)
```

## Architecture

The pipeline is a linear processing chain:

```
Archive → Extract → Classify (profile) → Filter → Review TUI → Tag TUI
  → Reorganize (local staging) → NAS configs → Sync to NAS (robocopy /Z)
```

### Components

| File | Role |
|---|---|
| `src/cli.ts` | Entry point. Prompts user for ZIP path and subscription. Orchestrates the pipeline. |
| `src/profiles/types.ts` | `SubscriptionProfile` and `ClassifiedModel` interfaces |
| `src/profiles/index.ts` | Profile registry — maps subscription name → profile module |
| `src/profiles/loot-studios.ts` | LootStudios profile: extraction rules + filter config |
| `src/profiles/flesh-of-gods.ts` | Flesh of Gods profile: extraction rules + filter config |
| `src/profiles/rescale.ts` | Rescale profile: folder-of-ZIPs extraction, single-model + Pack pose-variant handling |
| `src/profiles/archvillain-games.ts` | Archvillain Games profile: folder-of-RARs, pose-per-model split, per-pose image matching |
| `src/profiles/dmstash.ts` | DM Stash profile: folder-of-ZIPs, category-per-ZIP, multi-figure split, 32mm filter, FDM terrain |
| `src/pipeline/extractor.ts` | `extractArchive()` — ZIP or RAR to temp folder; also accepts pre-extracted folders and folders of archives |
| `src/pipeline/classifier.ts` | Calls `profile.classify()`, returns list of `ClassifiedModel` |
| `src/pipeline/filter.ts` | Applies profile's include/exclude filter (support types, FDM) |
| `src/pipeline/reviewer.ts` | Interactive TUI (inquirer): FDM vs Resin choice, unclassified file handling |
| `src/pipeline/tagger.ts` | Three-phase TUI: (1) classification tag per category group (hero/monster/etc.), (2) structured metadata per model type — CR for monsters, race/class/gender for heroes and NPCs — followed by free-text content tags, (3) image URL prompt for subscriptions that don't include images in the download |
| `src/pipeline/session.ts` | Saves and restores tagging state to a JSON file — allows resuming a run if interrupted before NAS write |
| `src/pipeline/reorganizer.ts` | Builds the organised folder tree in a **local staging dir** (no network); per-file `resilientCopy`; model-level `config.orynt3d`. Reports incomplete models. |
| `src/pipeline/resilient-copy.ts` | `resilientCopy` (size-skip + atomic temp/rename + retry-with-backoff) and `retryTransient` |
| `src/pipeline/nas-sync.ts` | `writeNasConfigs` (sub/pack configs straight to NAS, write-once) and `syncToNas` (`robocopy /Z /FFT` restartable; resilient tree-walk fallback off-Windows) |
| `src/cli-sync.ts` | `npm run sync` — re-run `syncToNas` alone against the last staging dir (VPN-drop recovery) |
| `src/pipeline/config-writer.ts` | Builds `config.orynt3d` at subscription, pack, and model level |
| `docker/` | Self-contained NAS container — runs the pipeline on the QNAP (local disk, no VPN). `docker compose -f compose.nas.yml run --rm pipeline`. Spec: `docs/nas-container-spec.md`. |

### Profile Interface

```ts
interface SubscriptionProfile {
  name: string                                    // also used as NAS subfolder name
  classify(rootFolder: string, originalInputPath?: string): Promise<ClassifiedModel[]>
  filter: { include: SupportType[]; includeFDM: boolean }
  categoryMappings: Record<string, CategoryMapping>  // auto-tag or prompt per category
  includesImages: boolean                         // true = copy images from ZIP; false = prompt for URL
  formatPackFolder(pack: string, scale: string): string
  formatModelFolder(modelName: string): string
}

interface ClassifiedModel {
  packName: string
  scale: string               // "32mm" | "75mm" | etc.
  category: string            // raw category name from source folder structure
  modelName: string           // clean display name, title-cased
  supportType: SupportType    // "ReadyToSlice" | "Lychee" | "Unsupported" | "FDM"
  classificationTag?: ClassificationTag  // assigned during tagging TUI
  sourceFolder: string
  files: string[]
  userTags?: string[]         // CR, creature type, race, class, gender, free-text tags
  imageUrl?: string           // cover image URL to fetch during reorganize
  imageSourceFolder?: string  // local folder to copy images from (profiles where includesImages is true)
}
```

## Tech Stack + Key Decisions

- **Language:** Node.js / TypeScript
- **TUI:** `inquirer` — interactive prompts for FDM/Resin choice and unclassified file handling
- **Archives:** `unzipper` (ZIP) + `node-unrar-js` (RAR, pure WASM — no native compilation) — extract downloads before processing
- **File system:** `fs-extra` — copy, ensureDir, move operations
- **Tests:** Vitest (ESM project)
- **DB (post-MVP):** `node:sqlite` (built-in, Node 22.5+) — import tracking
- **Python script retained** at `scripts/orynt3d_import_script.py` as reference material only — not part of the build

Python was considered but Node/TypeScript was chosen for consistency with the eventual downloader, import tracker, and 3dModelsBrowser ecosystem.

## Subscription Profiles

### LootStudios (Profile #1 — MVP)

**Input folder structure:**
```
ALL_{PackName}_{Scale}/
└── All_{PackName}_{Scale}/
    └── All_{Category}_{PackName}_{Scale}/
        ├── {Pack}_{Category}_{Scale}_LYCHEE/
        │   └── {ModelName}_{Scale}_LYCHEE/     ← leaf (STL/3MF files inside)
        ├── {Pack}_{Category}_{Scale}_ReadyToSlice/
        │   └── {ModelName}_{Scale}_ReadyToSlice/
        └── {Pack}_{Category}_{Scale}_UnSupported/
            ├── {ModelName}_{Scale}_UnSupported/
            └── {ModelName}_FDM/                 ← FDM variant (no scale suffix)
```

**Extraction rules:**
- Pack name: root folder → strip `All_` prefix, strip `_{Scale}` suffix
- Scale: root folder suffix (`_32mm`, `_75mm`, etc.)
- Category: 2nd-level folder → strip `All_` prefix, strip `_{Pack}_{Scale}` suffix
- Support type: 3rd-level folder suffix (`_LYCHEE`, `_ReadyToSlice`, `_UnSupported`, `_FDM`)
- Model name: leaf folder → strip `_{Scale}_{SupportType}` suffix → title-case

**Filter:**
- Include: `ReadyToSlice`
- FDM: included with interactive choice when both FDM and ReadyToSlice exist for same model
- Skip: `Lychee`, `Unsupported`

**Tag extraction opportunity (not yet implemented):**
Each model card on the LootStudios bundle page (`/bundle/{slug}/`) contains a `<div class="downloadTaxys">` element with pre-populated taxonomy tags — race, class, CR, size, creature type (e.g. `"Human", "Ranger", "Medium", "Humanoid", "CR 5"`). These can be scraped during the download session and stored alongside the release in the DB, then fed into the tagger step automatically instead of prompting the user to enter them. This would eliminate most manual tagging for LootStudios imports.

### Flesh of Gods (Profile #2 — Active)

**Input folder structure:**
```
{N} - SINGLE DOWNLOAD - {MONTH YEAR} - {PACK NAME}/
  {Type} - {Model Name} ({Size} - {base mm})/
    PRESUPPORTED/
      *.stl / *.3mf
    75 MM/                        ← skipped
  Bust - {Name}/                  ← skipped
```

**Extraction rules:**
- Pack name: last segment of root folder split by ` - `, title-cased
- Scale: hardcoded `32mm` (FoG releases one scale)
- Category: type prefix before ` - ` (`Enemy`, `Hero`, `NPC`)
- Files: taken exclusively from `PRESUPPORTED/` subfolder
- Size tag: extracted from `(Huge - 75 mm)` style suffix → stored as userTag (`huge`, `large`, etc.)

**Filter:**
- Include: `ReadyToSlice` (all FoG presupported files treated as ReadyToSlice)
- FDM: not applicable
- Skip: Bust folders, `75 MM` top-level folder

**Notes:**
- `includesImages: true` — images are in the model folder and copied automatically
- Releases come as two downloads per month: main pack + throwback pack — run pipeline separately against each folder

### Rescale (Profile #3 — Active)

**Input structure:** a folder containing one ZIP per model (or per pack). The extractor unpacks each ZIP into its own subfolder; the profile then walks each one.

- Each extracted ZIP contains exactly one inner wrapper folder.
- **Single model:** wrapper holds a `Supported/` subfolder (STL/3MF inside) or flat files with `_Sup.stl` / `_Bef.stl` suffixes. `_Bef` (Beefed) variants are skipped; `_Sup` are kept.
- **Pack:** wrapper holds multiple `{Name}_Supports/` pose subfolders — one `ClassifiedModel` per pose.
- Pack name: last path segment of the original input folder. Scale: hardcoded `32mm`.
- Model name: PascalCase-split of the ZIP/folder base name, stripping `Pack` prefix and `_Supports` suffix.
- Images: `includesImages: true` — copied from a `Renders/` subfolder or the wrapper folder itself (pack group image).
- Filter: all files treated as `ReadyToSlice`.

### Archvillain Games (Profile #4 — Active)

RAR archives (themed pack + Society/Bestiary compilations), manually assembled into a release-named folder. Spec: `docs/archvillain-games-profile-spec.md`.

- `classify()` walks the tree with one recursive, shape-agnostic rule (descend through any wrapper depth to the folders that hold model files) and returns `{ models, warnings }`. It refuses to guess on ambiguous structure (folder with files *and* model sub-folders; dead ends) — `cli.ts` prints those warnings and gates the write.
- Each pose becomes its own model (`Vaultsworn Zealot 1..4`); un-numbered STLs (shared bases) go into every pose; a kitbash guard keeps many-part centerpieces (Khazrai, Polystixis) as one model.
- Society/Bestiary reprints tagged `society` / `bestiary` from the `AVS` / `AVB` render marker.
- Keeps every `STL_*.stl` incl. `HOLLOWED_`; skips `.lys`. `scale` `32mm`; category always prompted.
- `tests/profiles/archvillain-structure.test.ts` pins each real download shape (Empire of Sands, High Seas doubled-wrapper) — add a case there when a new structure turns up.

### DM Stash (Profile #5 — Active)

Folder of ZIPs, one per category. Spec: `docs/dmstash-profile-spec.md`.

- Category from the ZIP filename (`SUPPORTED NPCs` / `SUPPORTED Monsters` / `Terrain`, or a `... Terrain Set - Name` form); tolerates a `(1)` browser suffix. NPCs prompt hero/npc, Monsters auto `monster`, Terrain auto `terrain`.
- Model folder `{Name} - Supported/` with an `STL/` subdir (or `Unsupported (FDM)/` for terrain) and one render.
- 32mm only — drop `75_*` files, keep prefix-less (`BUST_*`).
- Multi-figure folders (`Undead Dwarven Brothers` → Brook/Crook/…) split by the name token before `_Body`.
- Terrain → `supportType: FDM`, `filter.includeFDM: true`, tagged `fdm` + `terrain`.
- `tests/profiles/dmstash-structure.test.ts` pins each shape.

### Future profiles
Witchsong Miniatures — needs a raw download tree first (sub dropped; low priority).

## Target NAS Output Structure

```
\\192.168.254.200\data\3D Files\
  Loot Studios\
    config.orynt3d                    ← subscription-level (written once, never overwritten)
    Greenbrooke Invasion\
      config.orynt3d                  ← pack-level (written once per pack, never overwritten)
      Enemies\
        Battering Beast\
          config.orynt3d              ← model-level (always overwritten on re-run)
          BatteringBeast_32mm_ReadyToSlice.stl
        ...
      Environment\
        ...
  Flesh of Gods\
    config.orynt3d
    The Cursed Marshes\
      config.orynt3d
      Enemy\
        Bonegrinder Titan\
          config.orynt3d
          *.stl
          cover.png
```

One scanned source per subscription in Orynt3D. New packs drop into the subscription folder and are picked up on next scan.

## config.orynt3d Format

Version 5. Three levels of config files generated by the pipeline.

**Subscription-level** — cascades `subscription` attribute down to all models:
```json
{
  "version": 5,
  "scancfg": {
    "fileMode": 0, "modelMode": 2, "ifLeaf": false,
    "filetypes": [1], "autotags": 1, "archives": 0, "thumbnails": 0, "propagation": 0,
    "tags": { "include": [], "exclude": [], "clear": false },
    "attributes": {
      "include": [{"key": "subscription", "value": "lootstudios"}],
      "exclude": [], "clear": false
    }
  },
  "modelmeta": { "name": null, "notes": "", "tags": [], "cover": null, "collections": [], "attributes": [] }
}
```

**Pack-level** — cascades `release` and `scale` attributes:
```json
{
  "version": 5,
  "scancfg": {
    "fileMode": 0, "modelMode": 2, "ifLeaf": false,
    "filetypes": [1], "autotags": 1, "archives": 0, "thumbnails": 0, "propagation": 0,
    "tags": { "include": [], "exclude": [], "clear": false },
    "attributes": {
      "include": [
        {"key": "release", "value": "greenbrooke invasion"},
        {"key": "scale", "value": "32mm"}
      ],
      "exclude": [], "clear": false
    }
  },
  "modelmeta": { "name": null, "notes": "", "tags": [], "cover": null, "collections": [], "attributes": [] }
}
```

**Model-level** — sets model name + category/support tags:
```json
{
  "version": 5,
  "scancfg": {
    "fileMode": 0, "modelMode": 0, "ifLeaf": false,
    "filetypes": [1], "autotags": 1, "archives": 0, "thumbnails": 0, "propagation": 0,
    "tags": {
      "include": ["enemies", "32mm", "resin", "pre-supported"],
      "exclude": [], "clear": false
    },
    "attributes": { "include": [], "exclude": [], "clear": false }
  },
  "modelmeta": { "name": "Battering Beast", "notes": "", "tags": [], "cover": null, "collections": [], "attributes": [] }
}
```

## Current State

**v1 + v2 complete and running in production. Rescale + Archvillain profiles (v3 items) also shipped.**

- Five pipeline profiles (Loot Studios, Flesh of Gods, Rescale, Archvillain Games, DM Stash) implemented and verified live. DM Stash proven 2026-09-03 via the NAS container (Schism of the Drow, 21 models).
- Orynt3D migration to subscription-level sources complete for both subscriptions
- Release tracking DB live (`data/pipeline.db`) — tracks subscription, pack name, month, and owned/processed state. Backfilled 2026-08 against the actual NAS folders: 196 rows across Loot Studios, Flesh of Gods, Rescale, DM Stash, Archvillain (171 imported, 25 owned-not-imported). The `.db` file is committed to git (public repo, accepted) so it persists as the backup of record. Remember to `git add data/pipeline.db && git commit` after tracker sessions.
- Loot Studios is tracked as a complete owned catalogue from 2020-06 (112 rows). Every gap the report shows is a real owned-not-imported release. If a subscription ever has a genuine creator-skipped month, `getGaps` will flag it as a false positive (no way to mark "skipped") — a skip marker is a possible future add.
- `npm run pipeline` stages the organised tree locally, writes sub/pack configs to the NAS, then `robocopy /Z`-syncs. A dropped VPN mid-sync loses seconds, not the run: reconnect and `npm run sync` resumes from staging (or re-run the pipeline — `resilientCopy`'s size-skip makes re-staging near-free).
- `npm run download` provides status, list, backfill (historical imports), gap report, and manual ownership tracking
- Tracked subscriptions (`SUBSCRIPTIONS` in `src/cli-download.ts`): Loot Studios, Flesh of Gods, Rescale, Archvillain Games, DM Stash — all five have pipeline profiles now. Keys match `name.toLowerCase().replace(/\s+/g, '')`.

`scripts/orynt3d_import_script.py` is reference material only. `scripts/explode-styles.mjs` is a one-off (2026-08-30) that split pre-pipeline multi-style Archvillain folders into per-style model folders.

## Running on the NAS (preferred)

`docker/` is a self-contained container that runs the pipeline **on the QNAP** — `3D Files` and the download folder are local paths, so the write is local-disk and the multi-hour VPN sync is gone. Spec: `docs/nas-container-spec.md`.

- Only `docker/` needs to be on the QNAP; the container clones the repo at runtime, so the laptop dev loop is: edit `src/` → `git push origin master` → next `docker compose run` picks it up (`git fetch` + `git checkout --force -B`).
- Deployed and proven on `QBearNas` 2026-09-03 (first live run: DM Stash Schism of the Drow). Run it inside `tmux`/`screen` so an SSH/VPN drop detaches instead of killing the run; a killed `docker compose run` can orphan a container (`docker compose ... down --remove-orphans` then re-run — the `pipeline-repo` / `pipeline-npm` volumes make the retry fast).
- One-time setup on the QNAP: `cp docker/.env.example docker/.env`, fill in `GH_TOKEN` + the two share paths. `.env` is gitignored; `docker compose` reads it automatically.
- `docker compose -f compose.nas.yml run --rm pipeline` (also `... pipeline download` / `... pipeline sync`). One-off task, `--rm` deletes the container on exit; only the image + three small volumes persist.
- The container commits + force-pushes `data/pipeline.db` after each `pipeline`/`download` run — no more manual `git add data/pipeline.db`.
- Downloads are still manual: grab the archives, drop them in the NAS `downloads` folder, point the prompt at `/downloads/<release>`.
- The laptop `npm run pipeline` path (VPN write) stays as a fallback; tearing out the `robocopy`/`resilient-copy` VPN machinery is a documented future cleanup once the container is the default.
- `docker/lib/git-sync.sh` is a **copy** of the same file in 3dModelsBrowser's `docker/` (the two repos deploy independently); `tests/docker/git-sync.test.ts` exercises it against a throwaway repo.

## Known Gaps

- **LootStudios images** — LootStudios downloads don't include model images. The pipeline prompts for a URL per model during tagging (manual step). Automating this via release page scraping is planned for v3.
- **LootStudios download automation** — the bundle page uses a JS SPA where `LoadRightPanel()` triggers an async signed CDN URL via Intersection Observer. This doesn't fire reliably in headless Playwright. Parked — revisit if LootStudios adds an API or a simpler download path is found.
- **MMF download automation** — MyMiniFactory subscription access (`is_bought=false` for club content) is not exposed in their public API. HTML pages are Cloudflare-blocked (TLS fingerprint mismatch). Downloads must be done manually via the MMF site. API-based discovery works fine.
- **FoG direct site** — FoG releases are available on their own site as well as MMF. If MMF download automation stays blocked, the FoG direct site may be a viable alternative — investigate its structure and Cloudflare posture before building. Likely shares the same cookie-based auth pattern.
- **DM Stash download automation** — not on MyMiniFactory; own site. Downloads are manual (per-category ZIPs, signed S3 URLs that expire). Pipeline profile is built (`src/profiles/dmstash.ts`); only download automation is still open — investigate site structure / bot protection before building.
- **FDM geometry** — FDM files are currently tagged `fdm` but it's unconfirmed whether they are geometrically identical to resin files or have different geometry. Low priority until FDM imports are more common.

## Next Actions

1. **Archvillain Dec 2025+ backlog** — process the 9 owned-not-imported releases through the pipeline. Empire of Sands landed 2026-08-30 (resilient writer, all 23 models). Pre-pipeline multi-style folders split via `scripts/explode-styles.mjs` (42 folders → ~166 per-style, incl. Gharl / Kalineas). One empty `Pyre Knight (4 Styles)` shell on the NAS has an ACL that blocks CLI deletion — remove via Explorer.
2. **DM Stash backlog** — 5 owned-not-imported releases (2026-04 Bastion of the Wandering Mage → 2026-08 The Tales Grimm) plus 2026-09 Schism of the Drow needs a tracker backfill (processed 2026-09-03, added to tracker after the run). Work them through the NAS container.
3. **v3: Download automation investigation** — LootStudios direct site (SPA + signed CDN URL, needs a different approach); FoG direct site (alternative to MMF, investigate Cloudflare posture); DM Stash (own site, investigate separately)
4. **v3: LootStudios tag extraction** — scrape `<div class="downloadTaxys">` per model card during download session
5. **Gap-report skip marker** — optional: let a release be marked "creator skipped" so `getGaps` won't flag a genuinely-empty month as a false positive. Not currently needed (all tracked subs are gap-clean or the gaps are real).

## Orynt3D Migration (complete)

Both Loot Studios and Flesh of Gods are now configured as single subscription-level sources in Orynt3D. New pipeline runs drop pack folders into the subscription folder and are picked up on next scan automatically.

## Edge Case Policy

**Typos and naming convention deviations in source downloads are the user's responsibility to fix, not the pipeline's.**

When the pipeline fails to classify a folder or find expected files, it should log a clear warning and skip — not silently work around the problem with fuzzy matching or special-case code. The user can then inspect and rename the offending folder before re-running.

Before adding any code to handle a variant, typo, or unexpected structure, have a conversation to decide:
- Is this a consistent new convention from the creator (→ update the profile rules)?
- Is this a one-off error in the download (→ user fixes the folder, no code change)?

Do not accumulate edge-case handlers for one-off typos.

## Test Coverage Standard

**Target: 90% on in-scope functions.**

**In scope:** all exported pure functions in `src/profiles/` (extraction helpers); `src/pipeline/filter.ts`; `src/pipeline/config-writer.ts`; `src/pipeline/session.ts` save/load; `src/pipeline/resilient-copy.ts`; `src/pipeline/reorganizer.ts` (local staging — now temp-dir testable); `src/pipeline/nas-sync.ts` (real `robocopy` against temp dirs); `docker/lib/git-sync.sh` (exercised against a throwaway repo).

**Exempt:** CLI entry points (`src/cli*.ts`), TUI stages (`tagger.ts`, `reviewer.ts`), and `extractor.ts` / `classifier.ts` — interactive or bound to the archive libraries, not unit-testable without heavy mocking that adds no real value.

Current state: 125 tests across 14 files — all in-scope areas covered.

## Development Workflow — Required Before Merging Any Feature Branch

Every feature branch must clear these gates **before** merging to master. Claude must not merge autonomously without completing all three steps, even if the code compiles and tests pass.

1. **`/code-review --fix`** — run on the branch and apply any findings before merge
2. **Manual test run** — run `npm run pipeline` against real sample data and verify the golden path works end-to-end. For pipeline-touching changes, this means pointing the tool at an actual download folder and confirming models are classified, tagged, and written to the NAS correctly. For non-pipeline changes (DB, CLI), exercise the affected commands interactively.
3. **Confirm with user** — report what was tested and what the outcome was. Wait for explicit go-ahead before merging.

If sample data for a new profile isn't available yet, say so explicitly and ask the user to provide it before the merge gates can be cleared. Do not merge on "tests pass + types clean" alone for pipeline changes.

## Out of Spec (vs global CLAUDE.md standards)

None currently. All known gaps are documented above.

## Post-MVP Roadmap

- **v2: Release tracking** ✓ complete — SQLite DB with four ownership states; MMF API discovery for FoG and Rescale; manual download tracking; status report CLI
- **v3: Rescale pipeline profile** ✓ complete — folder-of-ZIPs extraction, single-model + pack pose variants
- **v3: Download automation** — LootStudios (SPA rendering blocker, parked); FoG direct site (investigate as MMF alternative); DM Stash (own site, investigate separately)
- **v3: LootStudios image automation** — scrape render images and taxonomy tags from bundle pages during download session
- **v3+: Additional pipeline profiles** — Witchsong Miniatures (sub dropped, low priority)
- **Future: Orynt3D scan trigger** — if Orynt3D exposes a CLI or API

## Relationship to 3dModelsBrowser

These two projects share no code and have no runtime dependency on each other. The only contract is the folder structure Orynt3D produces (which both projects must agree on):
- **orynt3d-pipeline** (this project): upstream — raw downloads → organized NAS folder → Orynt3D scans
- **3dModelsBrowser**: downstream — reads Orynt3D catalogue → searchable web gallery
