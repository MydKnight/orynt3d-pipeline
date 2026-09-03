# DM Stash Profile -- Design Spec

**Status:** Implemented
**Target:** v3
**Date:** 2026-09-02

Implemented and verified live 2026-09-03 -- Schism of the Drow (Sep '26)
processed through the NAS container: NPCs + Monsters + Terrain classified,
"Vessels of Irinax" multi-figure split, 21 models written.

Naming/structure variants found in real downloads and handled:
- `... Terrain Set - Name` -- category mid-string, not right after the 6-char
  prefix (Schism of the Drow, 98f330d)
- `SUPPORTED Monsters & Bust - ...` -- trailing "& Bust" before the " - "
  separator (The Arcane University, e63ce28)
- `{Name} - Supported/Supported/STL/...` -- a doubled wrapper folder; `stlDirFor`
  now probes one level deeper (The Arcane University, Professor Margaux)

## Problem

Fifth pipeline profile. DM Stash ships the cleanest structure of any subscription
so far: a folder of ZIPs, one per category, each holding one folder per model
with an `STL/` subdirectory. No download automation (their own site, not MMF) --
downloads stay manual.

## Input structure

The user manually downloads each category ZIP and drops them in a release-named
folder:

```
The Tales Grimm/
  {6char}-SUPPORTED NPCs - DM Stash Aug _'26 Release - The Tales Grimm.zip
  {6char}-SUPPORTED Monsters - DM Stash Aug _'26 Release - The Tales Grimm.zip
  {6char}-Terrain - Rapunzel's Cursed Tower.zip
```

Filenames carry a random 6-char prefix and may get a browser `(1)` suffix. The
**category is in the filename**: `SUPPORTED NPCs`, `SUPPORTED Monsters`,
`Terrain`.

### Inside an NPCs / Monsters ZIP

Model folders at the ZIP root (plus a loose `August 26 RPG Pack - Names.jpg` --
a name-reference sheet, ignore):

```
Mallory - Supported/
  Mallory the Envious - The Dark Ruler.jpg     ← one render per model folder
  LYS/  32_Supported_Mallory_Base.lys ...       ← Lychee, skip
  STL/  32_Supported_Mallory_Base.stl
        32_Supported_Mallory_Body.stl
        75_Supported_Mallory_Base.stl           ← 75mm, dropped
        75_Supported_Mallory_Body.stl
```

STL filename grammar (inconsistent): `{scale}_Supported_{Figure}_{Part}.stl`,
sometimes `{scale}_{Figure}_Supported_{Part}.stl` (Took), sometimes
`BUST_Supported_{Figure}_{Part}.stl` (busts, no scale prefix). `{Part}` is
`Base` / `Body` / `BasePlain` / `SpellEffect` / `LWing` / `BodyWhole` /
`BodyCut` / ... A `(hollowed for testing)` suffix appears on some parts.

**Most model folders = one figure.** A few bundle several named figures:
`Undead Dwarven Brothers - Supported/` holds `Brook`, `Crook`, `Hook`, `Mook`,
`Sook`, each with its own `_Base` + `_Body`.

### Inside a Terrain ZIP

```
Terrain - Rapunzel's Cursed Tower/
  Rapunzel_s Cursed Tower - Playable Dice Tower Terrain.jpg
  Unsupported (FDM)/  Terrain_Unsupported_RapunzelTower_A1_Output.stl ...
```

No `STL/`, no resin version -- terrain ships FDM-unsupported by design.

## Design decisions

### 1. Category from the ZIP filename

Strip the `{6char}-` prefix and any trailing `(N)`, then match:

| filename contains | raw category | tag mapping |
|---|---|---|
| `SUPPORTED NPCs` | `NPCs` | prompt `hero` / `npc` (the bucket mixes both) |
| `SUPPORTED Monsters` | `Monsters` | `monster` (auto) |
| `Terrain` | `Terrain` | `terrain` (auto) |
| none of the above | -- | structural warning, skip the ZIP |

`categoryMappings` in the profile drives the prompt-vs-auto behaviour. The raw
category is also the NAS category folder (`DM Stash/{release}/{NPCs|Monsters|Terrain}/{model}/`).

### 2. 32mm only

Keep an STL if its filename starts with `32_` **or** has no numeric scale prefix
(`BUST_...`). Drop anything starting with another number (`75_`). Scale on the
model is `'32mm'` (busts included -- close enough; not worth a separate token).

*Rejected:* keeping both scales (doubles every model), prompting per run (the
user only prints 32mm).

### 3. Terrain / FDM is included, not filtered

Terrain models get `supportType: 'FDM'`; the profile runs with
`filter.includeFDM: true`, so they flow through and land tagged `fdm` + `terrain`
rather than being dropped. Resin (`ReadyToSlice`) stays the norm for NPCs and
Monsters. Same mechanism covers a future FDM-only monster pack.

### 4. Multi-figure folders split

A model folder whose STLs contain **two or more distinct name tokens immediately
before `_Body`** splits into one model per figure. `Undead Dwarven Brothers -
Supported/` -> `Undead Dwarven Brothers - Brook`, `... - Crook`, `... - Hook`,
`... - Mook`, `... - Sook`. Each figure gets the STLs whose name contains
`_{Figure}_`; the folder's single render is shared to every figure. An STL that
matches no figure token -> structural warning (per the Edge Case Policy).

Single-figure folders (everyone else, including kitbash centrepieces like
Jabberwock and 2-body-option figures like Feena) stay one model, all parts.

### 5. Keep hollowed variants

`(hollowed for testing)` STLs come across alongside the solid part, same as
Archvillain's `HOLLOWED_`.

### 6. Names

- model folder `{Name} - Supported/` -> strip ` - Supported` -> `Mallory`,
  `The Big Bad`, `BUST Rook`
- terrain folder `Terrain - {Name}/` -> strip `Terrain - ` -> `Rapunzel's Cursed Tower`
- split figure -> `{unit name} - {Figure}` so they group in a gallery

### 7. Fixed profile values

- `scale`: `'32mm'`
- `filter`: `{ include: ['ReadyToSlice'], includeFDM: true }`
- `includesImages`: `true` (one `.jpg`/`.png` per model folder; shared to split figures)
- `formatPackFolder(pack)` -> `pack`; `formatModelFolder(name)` -> `name`
- `classify()` returns `{ models, warnings }` (the `ClassifyResult` shape, like Archvillain)

## classify() algorithm

```
packName = last path segment of originalInputPath ; scale = '32mm'

for each top-level dir in rootFolder (one per extracted ZIP):
  category = parseCategory(dir name)          # NPCs | Monsters | Terrain | null
  if null: warnings.push("unrecognised ZIP: <name>"); continue
  support = category === 'Terrain' ? 'FDM' : 'ReadyToSlice'

  for each sub-directory of the ZIP dir (model folders; loose files ignored):
    stlDir = <model>/STL || <model>/'Unsupported (FDM)'
             || <model>/*/STL || <model>/*/'Unsupported (FDM)'   (double-wrap)
             || <model>                                          (first that has *.stl)
    stls   = *.stl in stlDir, kept only if scale-32 (starts "32_" or no "<num>_" prefix)
    images = *.jpg/.jpeg/.png/.webp directly in <model>
    unit   = model folder name minus " - Supported" / "Terrain - "

    figureOf(f) = token matched by /_([A-Za-z0-9]+)_Body/i in the stem, else null
    figures = distinct non-null figureOf across stls

    if figures.length >= 2:
      for each figure F:
        modelName  = `${unit} - ${F}`
        files      = stls whose stem contains `_${F}_`
        (stls matching no figure -> warnings.push)
        push { packName, scale, category, modelName, supportType: support,
               sourceFolder: <model>, files, imageFiles: images }
    else:
      push one { ...same..., modelName: unit, files: all kept stls, imageFiles: images }
```

`parseCategory`: `/^[A-Za-z0-9]{6}-\s*(?:SUPPORTED\s+)?(NPCs|Monsters|Terrain)\b/i`
on the ZIP-dir name (which is the ZIP basename), tolerating a trailing `(\d+)`.

## Extractor

No change -- `extractArchive` already handles a folder of ZIPs (the original
Rescale path). Each ZIP extracts to `tempDir/{zipBaseName}/`, model folders
directly inside.

## Testing

TDD. Exported pure helpers get unit tests; a fixture-tree structure test locks
the shapes, same pattern as `archvillain-structure.test.ts`.

| Helper | Covers |
|---|---|
| `parseCategory` | prefix strip, `SUPPORTED ` optional, `(1)` suffix, unknown -> null |
| `stripSupported` | ` - Supported`, `Terrain - ` prefix |
| `isScale32` | `32_` yes, `75_` no, `BUST_` yes (no prefix), `Terrain_Unsupported_` yes |
| `figureToken` | `_Brook_Body` -> Brook, `_Feena_BodyWhole` -> Feena, `_Jabberwock_BodyCut` -> Jabberwock |

Structure fixtures: NPCs-shape (single-figure + BUST), Monsters-shape with the
Undead Dwarven Brothers split, Terrain-shape (FDM), an unrecognised ZIP.

Coverage: in-scope per the standing 90% target on the pure helpers.

## Build order

1. `docs/dmstash-profile-spec.md` -- Locked 2026-09-02.
2. `tests/profiles/dmstash.test.ts` -- 9 helper tests + `dmstash-structure.test.ts` 5 fixture tests -- Implemented 2026-09-02.
3. `src/profiles/dmstash.ts` -- Implemented 2026-09-02.
4. Registered in `src/profiles/index.ts` -- 2026-09-02.
5. `filter.ts` already supports `includeFDM` -- no change.
6. Functional run against the real `The Tales Grimm` download -- Verified 2026-09-02: 23 models, 0 warnings (NPCs 12, Monsters 10 incl. Undead Dwarven Brothers split to 5, Terrain 1 FDM).
   Expect: NPCs ~13, Monsters split (Undead Dwarven Brothers -> 5), Terrain 1,
   0 warnings; 75mm files absent; terrain models `supportType: FDM`.
7. CLAUDE.md profile section + components table; REPO_AUDIT.
8. `/code-review` + live `npm run pipeline` -> NAS -> merge.

## Out of scope

- Download automation (their site; manual downloads stay manual).
- 75mm scale.
- The `LYS/` Lychee project files.
- Busts as a distinct scale/category -- they ride in as regular models.
