# orynt3d-pipeline

A subscription-aware file processing pipeline that takes raw 3D model subscription downloads and reorganizes them into the folder structure Orynt3D expects — with `orynt3d.config` metadata files pre-generated so models come in tagged and ready to browse.

## Current Status

**Active — v1 + v2 complete, running in production.**

Three profiles (Loot Studios, Flesh of Gods, Rescale) are implemented, tested, and verified against real downloads. Orynt3D migration to subscription-level sources is complete. Release tracking (v2) is built (`npm run download`) but the DB is not yet populated -- backfilling historical imports is the next step.

**Known gaps:** LootStudios downloads don't include model images — the pipeline prompts for a URL per model during tagging. Automating this (scraping the release page) is a planned v3 improvement.

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
  ├── Prompts for structured metadata per model type (CR for monsters; race, class, gender for heroes/NPCs)
  ├── Accepts free-text content tags per model (race, gender, theme, etc.)
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
| Loot Studios | ✓ Active |
| Flesh of Gods | ✓ Active |
| Rescale | ✓ Active |
| Archvillain Games | Release tracking only (no pipeline profile yet) |
| DM Stash | Release tracking only (no pipeline profile yet) |
| Witchsong Miniatures | Future |

## Setup

Requirements:
- Node.js 22.5+
- NAS accessible via UNC path or mapped drive

```
npm install
cp .env.example .env
# edit .env — set NAS_3D_FILES_PATH to your NAS path
```

## Usage

```
npm run pipeline
```

The tool prompts for a ZIP path (or pre-extracted folder) and which subscription, then walks through classification and tagging interactively before writing to the NAS.

## Roadmap

**v1 — MVP** ✓ Complete
- [x] Project initialization (TypeScript, Vitest, package.json)
- [x] Core interfaces (SubscriptionProfile, ClassifiedModel)
- [x] LootStudios profile with extraction rules + tests
- [x] Flesh of Gods profile with extraction rules + tests
- [x] ZIP extraction (also accepts pre-extracted folders)
- [x] Classification engine
- [x] Variant filter (ReadyToSlice; FDM interrogation)
- [x] Interactive TUI — classification, structured metadata (CR, race/class/gender), free-text tags, image URLs
- [x] Session save/resume (tagging progress persisted before NAS write)
- [x] NAS output (organized folder structure)
- [x] orynt3d.config generation (subscription, pack, model level)

**v2 — Tracking** ✓ Complete
- [x] SQLite release tracking — 4 states (imported / downloaded / owned / not-owned) per subscription
- [x] Pipeline integration — prompts to mark release processed after NAS write; warns on duplicate import
- [x] `npm run download` tracker CLI — status, list, backfill historical imports, manual ownership

**v3 — Automation**
- [x] Rescale profile (folder-of-ZIPs extraction, single-model + pack pose variants)
- [ ] Download automation — LootStudios (SPA + signed CDN URL, blocked), FoG direct site (investigate), DM Stash (own site, investigate)
- [ ] LootStudios image automation (fetch render images from release page — currently manual URL-per-model)
- [ ] Additional subscription profiles (DM Stash, Archvillain Games, Witchsong Miniatures)

**Future**
- [ ] Orynt3D scan trigger (if API/CLI becomes available)
