# orynt3d-pipeline

A subscription-aware file processing pipeline that takes raw 3D model subscription downloads and reorganizes them into the folder structure Orynt3D expects — with `orynt3d.config` metadata files pre-generated so models come in tagged and ready to browse.

## Current Status

**Active — design complete, implementation not yet started.**

The architecture has been fully designed (see `CLAUDE.md`). The existing Python script in `scripts/` is reference material only and is not part of the pipeline build.

**Known gaps:** No implementation code. No tests. `package.json` and project structure not yet created.

## What It Does

```
[Subscription ZIP in Downloads]
         ↓
  orynt3d-pipeline
  ├── Extracts the ZIP
  ├── Identifies the subscription (LootStudios, Flesh of Gods, etc.)
  ├── Classifies every model: pack, scale, category, support type
  ├── Filters to only the wanted variant (e.g. ReadyToSlice resin)
  ├── Asks interactively when a model has both FDM and resin variants
  ├── Asks interactively about anything that can't be auto-classified
  ├── Writes an organized folder structure to the NAS
  └── Generates orynt3d.config files so Orynt3D picks up metadata automatically
         ↓
  \\NAS\3D Files\{Subscription}\{Pack_Scale}\{Category}\{Model Name}\
         ↓
  Orynt3D scans the subscription folder → models appear in library tagged and ready
```

Each subscription has a **profile** — a set of rules that teaches the pipeline how to interpret that creator's ZIP structure and map it to the normalized output. Adding a new subscription means writing a new profile module.

## Where This Lives in the Pipeline

```
[Subscription downloads]
        ↓
  orynt3d-pipeline        ← this project
        ↓
     Orynt3D (desktop app — scans folder, catalogues models)
        ↓
  3dModelsBrowser (web gallery — searchable from anywhere)
```

## Tech Stack

- **Node.js / TypeScript**
- **inquirer** — interactive TUI for review/classification decisions
- **unzipper** — ZIP extraction
- **fs-extra** — file system operations
- **Vitest** — tests

## Supported Subscriptions

| Subscription | Status |
|---|---|
| Loot Studios | Profile #1 — MVP |
| Flesh of Gods | Planned (profile #2) |
| Archvillain Games | Future |
| DM Stash | Future |
| Rescue Miniatures | Future |
| Witchsong Miniatures | Future |

## Setup

> Setup instructions will be added when the project is initialized.

Requirements:
- Node.js 22.5+ (uses built-in `node:sqlite` for future tracking)
- NAS accessible via UNC path or mapped drive
- `.env` file with `NAS_3D_FILES_PATH` and `STAGING_PATH` (see `.env.example`)

## Usage

> CLI usage will be documented once implemented.

Basic flow:
```
npm run pipeline -- --zip "C:\Users\shilo\Downloads\ALL_GREENBROOKEINVASION_32MM.zip"
```

The tool will ask which subscription the ZIP is from, then walk through classification interactively.

## Roadmap

**v1 — MVP**
- [ ] Project initialization (TypeScript, Vitest, package.json)
- [ ] Core interfaces (SubscriptionProfile, ClassifiedModel)
- [ ] LootStudios profile with extraction rules + tests
- [ ] ZIP extraction
- [ ] Classification engine
- [ ] Variant filter (ReadyToSlice; FDM interrogation)
- [ ] Interactive TUI for review queue
- [ ] NAS output (organized folder structure)
- [ ] orynt3d.config generation (subscription, pack, model level)

**v2 — Tracking**
- [ ] SQLite import tracking (what's been processed, when)
- [ ] Duplicate detection (skip packs already imported)

**v3 — Automation**
- [ ] Download automation (detect missing months, fetch them)
- [ ] Flesh of Gods profile
- [ ] Additional subscription profiles

**Future**
- [ ] Orynt3D scan trigger (if API/CLI becomes available)
- [ ] Migration helper for existing per-month Orynt3D source structure
