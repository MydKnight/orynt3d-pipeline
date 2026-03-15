# orynt3d-pipeline

**Status: Planned — skeleton only. Full planning session required before any implementation.**

A file processing pipeline that takes raw 3D model subscription downloads — each with their own inconsistent folder structures, file formats, and naming conventions — and reorganizes them into the folder structure that [Orynt3D](https://orynt3d.com/) expects for scanning and cataloguing.

## Concept

- Point the tool at a freshly-downloaded subscription release (zip or folder)
- Detect the subscription source and apply the appropriate processing profile
- Classify files by scale (28/32mm vs 75mm), file type (STL vs 3MF), and support status (pre-supported vs unsupported)
- Reorganize into Orynt3D's target folder structure: `Manufacturer / Pack / SupportStatus / Scale / Category`
- Handle edge cases (mixed-scale packs, unrecognized structures) with a review/manual step rather than silently dropping files
- Output is a folder ready for Orynt3D to scan, preview, and import

## Where This Lives in the Pipeline

```
[Subscription downloads]
        ↓
  orynt3d-pipeline        ← this project
        ↓
     Orynt3D (desktop app — scan, preview, config.orynt3d per model)
        ↓
  3dModelsBrowser (web gallery — searchable from anywhere)
```

## What Exists Now

`scripts/orynt3d_import_script.py` — a Python skeleton that scans an already-organized NAS directory for `.stl/.obj/.fbx/.3mf` files, extracts metadata from folder paths, and produces a structured JSON manifest. This is an early partial implementation — it handles the scanning side but not the download intake or reorganization logic.

## ⚠️ Do Not Start Building Without a Full Planning Session

This project has significant design questions that need to be resolved before real implementation begins.

See `CLAUDE.md` for the required first step when opening this project.

## Known Open Questions (pre-planning)

- Which subscription sources need profiles? (folder structures, zip conventions, naming patterns vary per creator)
- Does Orynt3D accept a bulk JSON import to register models, or is triggering a folder scan the only intake path?
- Scale detection — is scale reliably in folder names, file names, or a readme? Or does it require per-subscription rules?
- FDM vs resin classification — same question
- 3MF vs STL — keep both, prefer one, or filter by type?
- What's the target NAS folder structure Orynt3D expects exactly?
- Should the pipeline be a CLI tool, a GUI, or a drag-and-drop Electron app?
- Review/override step — what does the UX for unclassified or ambiguous files look like?
