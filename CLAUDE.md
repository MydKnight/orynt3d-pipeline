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
ZIP → Extract → Classify (profile) → Filter → Review TUI → Reorganize → Write config.orynt3d → NAS
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
| `src/pipeline/extractor.ts` | ZIP extraction to temp folder (also accepts pre-extracted folders and folders of ZIPs) |
| `src/pipeline/classifier.ts` | Calls `profile.classify()`, returns list of `ClassifiedModel` |
| `src/pipeline/filter.ts` | Applies profile's include/exclude filter (support types, FDM) |
| `src/pipeline/reviewer.ts` | Interactive TUI (inquirer): FDM vs Resin choice, unclassified file handling |
| `src/pipeline/tagger.ts` | Three-phase TUI: (1) classification tag per category group (hero/monster/etc.), (2) structured metadata per model type — CR for monsters, race/class/gender for heroes and NPCs — followed by free-text content tags, (3) image URL prompt for subscriptions that don't include images in the download |
| `src/pipeline/session.ts` | Saves and restores tagging state to a JSON file — allows resuming a run if interrupted before NAS write |
| `src/pipeline/reorganizer.ts` | Writes target folder structure on NAS; copies STL/3MF files and images; fetches cover images from URL if provided |
| `src/pipeline/config-writer.ts` | Writes `config.orynt3d` files at subscription, pack, and model level |

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
- **ZIP:** `unzipper` — extract downloads before processing
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

### Future profiles
Archvillain Games, DM Stash, Witchsong Miniatures.
Each needs a raw download tree before a profile can be written.

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

**v1 + v2 complete and running in production. Rescale profile (v3 item) also shipped.**

- Three pipeline profiles (Loot Studios, Flesh of Gods, Rescale) implemented and verified
- Orynt3D migration to subscription-level sources complete for both subscriptions
- Release tracking DB live (`data/pipeline.db`) — tracks subscription, pack name, month, and owned/processed state. Backfilled 2026-08 against the actual NAS folders: 196 rows across Loot Studios, Flesh of Gods, Rescale, DM Stash, Archvillain (171 imported, 25 owned-not-imported). The `.db` file is committed to git (public repo, accepted) so it persists as the backup of record. Remember to `git add data/pipeline.db && git commit` after tracker sessions.
- Loot Studios is tracked as a complete owned catalogue from 2020-06 (112 rows). Every gap the report shows is a real owned-not-imported release. If a subscription ever has a genuine creator-skipped month, `getGaps` will flag it as a false positive (no way to mark "skipped") — a skip marker is a possible future add.
- `npm run pipeline` prompts to mark the release processed after NAS write; warns if already imported
- `npm run download` provides status, list, backfill (historical imports), gap report, and manual ownership tracking
- Tracked subscriptions (`SUBSCRIPTIONS` in `src/cli-download.ts`): Loot Studios, Flesh of Gods, Rescale (have pipeline profiles); DM Stash, Archvillain Games (release tracking only — no profile yet). Keys match what a future profile would generate (`name.toLowerCase().replace(/\s+/g, '')`).

The existing `scripts/orynt3d_import_script.py` is reference material only — not part of the pipeline.

## Known Gaps

- **LootStudios images** — LootStudios downloads don't include model images. The pipeline prompts for a URL per model during tagging (manual step). Automating this via release page scraping is planned for v3.
- **LootStudios download automation** — the bundle page uses a JS SPA where `LoadRightPanel()` triggers an async signed CDN URL via Intersection Observer. This doesn't fire reliably in headless Playwright. Parked — revisit if LootStudios adds an API or a simpler download path is found.
- **MMF download automation** — MyMiniFactory subscription access (`is_bought=false` for club content) is not exposed in their public API. HTML pages are Cloudflare-blocked (TLS fingerprint mismatch). Downloads must be done manually via the MMF site. API-based discovery works fine.
- **FoG direct site** — FoG releases are available on their own site as well as MMF. If MMF download automation stays blocked, the FoG direct site may be a viable alternative — investigate its structure and Cloudflare posture before building. Likely shares the same cookie-based auth pattern.
- **DM Stash** — not on MyMiniFactory; has its own site. Needs a dedicated platform implementation. Investigate site structure and whether Cloudflare or similar bot protection is in use before building. Profile (`src/profiles/dmstash.ts`) also needed once download folder structure is known. Release tracking works today via `npm run download` (key `dmstash`).
- **Archvillain Games** — pipeline profile (`src/profiles/archvillaingames.ts`) not yet built; needs a raw download tree to inspect first. Release tracking works today via `npm run download` (key `archvillaingames`).
- **FDM geometry** — FDM files are currently tagged `fdm` but it's unconfirmed whether they are geometrically identical to resin files or have different geometry. Low priority until FDM imports are more common.

## Next Actions

1. **v3: Download automation investigation** — LootStudios direct site (SPA + signed CDN URL, needs a different approach); FoG direct site (alternative to MMF, investigate Cloudflare posture); DM Stash (own site, investigate separately)
2. **v3: LootStudios tag extraction** — scrape `<div class="downloadTaxys">` per model card during download session
3. **Additional pipeline profiles** — DM Stash, Archvillain Games, Witchsong Miniatures (each needs a raw download tree first). Archvillain has a full release list in the DB and 8 old manual imports on the NAS ("Archvillian Games" folder) that would be reprocessed or accepted as-is.
4. **Gap-report skip marker** — optional: let a release be marked "creator skipped" so `getGaps` won't flag a genuinely-empty month as a false positive. Not currently needed (all tracked subs are gap-clean or the gaps are real).

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

**In scope:** all exported pure functions in `src/profiles/` (extraction helpers) and `src/pipeline/filter.ts` and `src/pipeline/config-writer.ts`.

**Exempt:** CLI (`src/cli.ts`), TUI stages (`tagger.ts`, `reviewer.ts`), and I/O stages (`extractor.ts`, `reorganizer.ts`, `session.ts`, `classifier.ts`) — these are interactive or file-system-bound and not unit-testable without heavy mocking that adds no real value.

Current state: 54 tests across 5 files — all in-scope areas covered.

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
- **v3+: Additional pipeline profiles** — DM Stash, Archvillain Games, Witchsong Miniatures
- **Future: Orynt3D scan trigger** — if Orynt3D exposes a CLI or API

## Relationship to 3dModelsBrowser

These two projects share no code and have no runtime dependency on each other. The only contract is the folder structure Orynt3D produces (which both projects must agree on):
- **orynt3d-pipeline** (this project): upstream — raw downloads → organized NAS folder → Orynt3D scans
- **3dModelsBrowser**: downstream — reads Orynt3D catalogue → searchable web gallery
