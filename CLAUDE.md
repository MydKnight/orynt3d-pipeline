# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## ⚠️ STOP — Read This First

**This project has a skeleton but has not been designed yet. Do not extend the existing script, add new scripts, or make any architectural decisions without completing the planning session described below.**

The README describes the concept. The existing Python script is a starting point, not a spec. Everything beyond basic file scanning is an open question.

## Step 1: Enter Plan Mode

When this project is opened for active development, the first action is:

```
/plan
```

The planning session must cover at minimum:

- **Subscription profiles:** Which subscription sources need to be supported first? What are their zip/folder conventions, naming patterns, and file type mixes? How do profiles get defined and maintained as new subscriptions are added?
- **Orynt3D intake mechanism:** Does Orynt3D accept a bulk JSON import to register models, or is a folder scan the only intake path? The answer determines whether the pipeline outputs a ready-to-scan folder, a JSON manifest, or both.
- **Target folder structure:** What exactly does Orynt3D expect? Confirm the `Manufacturer / Pack / SupportStatus / Scale / Category` hypothesis against actual Orynt3D behavior before building around it.
- **Classification rules:** How is scale detected (28/32mm vs 75mm)? How is support status detected (pre-supported vs unsupported)? How is FDM vs resin determined? Are these derivable from folder/file names, or do they require per-subscription configuration?
- **File format handling:** STL vs 3MF — keep both? Prefer one? Filter by intended printer type?
- **Review/override step:** What happens to files that can't be classified? Silent skip (unacceptable), log for manual review, interactive prompt, or a separate "uncategorized" staging area?
- **Interface:** CLI tool (run against a download folder), GUI, or Electron drag-and-drop? Single-use script vs. persistent tool?
- **Tech stack:** Python is the natural fit given the existing skeleton and file-processing domain. Confirm or deviate with justification.

## Relationship to `3dModelsBrowser`

These two projects serve opposite ends of the same pipeline with Orynt3D as the bridge:

- **orynt3d-pipeline** (this project) = upstream intake — raw subscription downloads → organized folder structure → Orynt3D scans and catalogues
- **3dModelsBrowser** = downstream display — reads Orynt3D's catalog → searchable web gallery

They share no code and have no runtime dependency on each other. The only contract is the folder structure Orynt3D produces, which both projects must agree on.

## What Exists Now

`scripts/orynt3d_import_script.py` — scans a NAS directory for `.stl/.obj/.fbx/.3mf` files, extracts metadata from folder path structure (`manufacturer/pack/support_status/category`), groups multi-part models and variants, and outputs a structured JSON manifest (`orynt3d_import.json`). Interactive CLI with basic/detailed/manufacturer preview modes.

This is useful reference code for the scanning and metadata extraction logic but does not implement download intake or reorganization.

## What NOT to Do

- Do not extend the Python skeleton without a plan — it may not survive the design decisions intact
- Do not hardcode subscription-specific logic before the profile system is designed
- Do not assume Orynt3D's folder structure — verify it during the planning session
- Do not skip the review/override step design — silently dropping unclassified files would cause real data loss

## Known Open Questions (pre-planning)

- Which subscriptions are in scope for v1? (Likely: the ones with the most monthly volume)
- Does Orynt3D have a documented import format, or is folder scanning the only path?
- Scale naming conventions: are "28mm", "32mm", "75mm" reliably present in folder or file names across subscriptions?
- Is the FDM/resin distinction worth encoding in the folder structure, or is it a tag/property within Orynt3D?
- What's the monthly file volume per subscription that this needs to handle efficiently?
