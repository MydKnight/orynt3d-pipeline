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
| `src/pipeline/extractor.ts` | ZIP extraction to temp folder |
| `src/pipeline/classifier.ts` | Calls `profile.classify()`, returns list of `ClassifiedModel` |
| `src/pipeline/filter.ts` | Applies profile's include/exclude filter (support types, FDM) |
| `src/pipeline/reviewer.ts` | Interactive TUI (inquirer): FDM vs Resin choice, unclassified file handling |
| `src/pipeline/reorganizer.ts` | Writes target folder structure on NAS |
| `src/pipeline/config-writer.ts` | Writes `config.orynt3d` files at subscription, pack, and model level |

### Profile Interface

```ts
interface SubscriptionProfile {
  name: string
  classify(rootFolder: string): ClassifiedModel[]
  filter: {
    include: SupportType[]  // e.g. ["ReadyToSlice"]
    includeFDM: boolean     // true = include FDM variants (with TUI interrogation)
  }
  formatPackFolder(pack: string, scale: string): string
  formatModelFolder(modelName: string): string
}

interface ClassifiedModel {
  packName: string
  scale: string        // "32mm" | "75mm" | etc.
  category: string     // "Enemies" | "Heroes" | "Environment" | etc.
  modelName: string    // clean display name (title-cased, no suffixes)
  supportType: SupportType  // "ReadyToSlice" | "Lychee" | "Unsupported" | "FDM"
  sourceFolder: string      // absolute path in extracted temp folder
  files: string[]           // STL/3MF files inside this folder
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

### Other subscriptions (future profiles)
Flesh of Gods, Archvillain Games, DM Stash, Rescue Miniatures, Witchsong Miniatures.
Each needs a raw download tree before a profile can be written.

## Target NAS Output Structure

```
\\192.168.254.200\data\3D Files\
  Loot Studios\
    config.orynt3d                    ← subscription-level config
    GreenbrookeInvasion_32mm\
      config.orynt3d                  ← pack-level config
      Enemies\
        Battering Beast\
          config.orynt3d              ← model-level config
          BatteringBeast_32mm_ReadyToSlice.stl
        ...
      Environment\
        ...
```

One scanned source per subscription in Orynt3D (not per monthly release). New months drop into the subscription folder and Orynt3D picks them up on next scan.

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

Skeleton only. The existing `scripts/orynt3d_import_script.py` is reference material — it scans an already-organized NAS folder and generates a JSON manifest. It does not implement download intake or reorganization and is not part of the new pipeline.

No implementation has started. This CLAUDE.md is the design spec. Implementation begins with the LootStudios profile and pipeline engine.

## Known Gaps

- No tests (none yet — test suite will be built alongside implementation)
- No `package.json`, `tsconfig.json`, or `src/` structure yet
- `modelMode` values (0 vs 2) in `config.orynt3d` need confirmation during config-writer implementation
- FDM variant handling: are FDM files geometrically identical to resin files (just no supports), or different geometry? Affects tagging.
- Pipeline handles only ZIPs for now — already-extracted folders not yet supported
- NAS folder confirmed: `Loot Studios` (with space). Existing manual structure: `Loot Studios\{Pack}\Organized\{category}\{ModelName}\config.orynt3d`

## Next Actions

1. **Initialize the Node/TypeScript project** — `package.json`, `tsconfig.json`, `vitest.config.ts`, `.env.example`
2. **Write `src/profiles/types.ts`** — core interfaces (`SubscriptionProfile`, `ClassifiedModel`, `SupportType`)
3. **Write `src/profiles/loot-studios.ts`** — classification rules, filter config, tests first (TDD)
4. **Write `src/pipeline/extractor.ts`** — ZIP extraction
5. **Write `src/pipeline/classifier.ts`** — calls profile, returns classified models
6. **Write `src/pipeline/filter.ts`** — applies include/FDM filter
7. **Write `src/pipeline/reviewer.ts`** — TUI interrogation (inquirer)
8. **Write `src/pipeline/reorganizer.ts`** — writes NAS folder structure
9. **Write `src/pipeline/config-writer.ts`** — writes `config.orynt3d` files
10. **Write `src/cli.ts`** — entry point, orchestrates the pipeline
11. **Orynt3D migration** — after first successful run: remove old per-month sources, add per-subscription sources

## Orynt3D Migration (one-time, post-MVP)

Current state: each monthly LootStudios release is its own Orynt3D scanned source (suboptimal).
After MVP is running:
1. Existing organized months → move into `\\NAS\3D Files\Loot Studios\` subfolder per pack
2. In Orynt3D: remove old per-month sources, add `Loot Studios\` as a single source
3. Orynt3D rescans, picks up everything
4. Repeat per subscription as profiles are written

## Out of Spec (vs global CLAUDE.md standards)

- **Tests:** None yet. Test coverage standard TBD — will be defined at the start of implementation session and documented here.
- **No `.env.example`** yet — will be created in project init step with `NAS_3D_FILES_PATH` and `STAGING_PATH`.

## Post-MVP Roadmap

- **v2: Import tracking** — SQLite database (`node:sqlite`) tracking what has been processed and when
- **v2: Duplicate detection** — check if a pack has already been imported before processing
- **v3: Download automation** — check what months are available vs. what's been downloaded; fetch missing releases
- **v3+: Additional profiles** — Flesh of Gods, Archvillain Games, DM Stash, Rescue Miniatures, Witchsong Miniatures
- **Future: Orynt3D scan trigger** — if Orynt3D exposes a CLI or API

## Relationship to 3dModelsBrowser

These two projects share no code and have no runtime dependency on each other. The only contract is the folder structure Orynt3D produces (which both projects must agree on):
- **orynt3d-pipeline** (this project): upstream — raw downloads → organized NAS folder → Orynt3D scans
- **3dModelsBrowser**: downstream — reads Orynt3D catalogue → searchable web gallery
