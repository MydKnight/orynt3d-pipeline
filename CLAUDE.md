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
| `src/pipeline/extractor.ts` | ZIP extraction to temp folder (also accepts pre-extracted folders) |
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
  classify(rootFolder: string): Promise<ClassifiedModel[]>
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

### Future profiles
Archvillain Games, DM Stash, Rescue Miniatures, Witchsong Miniatures.
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

**v1 complete and running in production.** Both profiles are implemented and verified against real downloads. Orynt3D migration to subscription-level sources is complete for both Loot Studios and Flesh of Gods.

The existing `scripts/orynt3d_import_script.py` is reference material only — not part of the pipeline.

## Known Gaps

- **LootStudios images** — LootStudios downloads don't include model images. The pipeline prompts for a URL per model during tagging (manual step). Automating this via release page scraping is planned for v3.
- **Flesh of Gods download sources** — FoG releases are available via both MyMiniFactory and the FoG site directly. When automated download is built in v3, evaluate which source is preferable (API availability, login method, reliability).
- **FDM geometry** — FDM files are currently tagged `fdm` but it's unconfirmed whether they are geometrically identical to resin files or have different geometry. Low priority until FDM imports are more common.

## Next Actions

1. **v2: Import tracking** — SQLite (`node:sqlite`) database recording what has been processed and when
2. **v2: Duplicate detection** — check if a pack has already been imported before processing
3. **v3: Download automation** — detect missing months, fetch them; handle LootStudios image fetching from release page
4. **Additional profiles** — Archvillain Games, DM Stash, Rescue Miniatures, Witchsong Miniatures (each needs a raw download tree first)

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

Current state: 46 tests across 4 files — all in-scope areas covered.

## Out of Spec (vs global CLAUDE.md standards)

None currently. All known gaps are documented above.

## Post-MVP Roadmap

- **v2: Import tracking** — SQLite (`node:sqlite`) recording what has been processed and when; duplicate detection to skip already-imported packs
- **v3: Download automation** — detect missing months and fetch them; LootStudios image automation (fetch render images from release page instead of manual URL entry)
- **v3+: Additional profiles** — Archvillain Games, DM Stash, Rescue Miniatures, Witchsong Miniatures
- **Future: Orynt3D scan trigger** — if Orynt3D exposes a CLI or API

## Relationship to 3dModelsBrowser

These two projects share no code and have no runtime dependency on each other. The only contract is the folder structure Orynt3D produces (which both projects must agree on):
- **orynt3d-pipeline** (this project): upstream — raw downloads → organized NAS folder → Orynt3D scans
- **3dModelsBrowser**: downstream — reads Orynt3D catalogue → searchable web gallery
