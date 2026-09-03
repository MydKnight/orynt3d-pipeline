import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { SubscriptionProfile, ClassifiedModel, ClassifyResult, SupportType } from './types.js'

// ─── Extraction helpers (exported for unit testing) ───────────────────────────

const MODEL_EXTS = /\.(stl|3mf)$/i
const IMAGE_EXTS = /\.(jpe?g|png|webp)$/i

/**
 * DM Stash ZIP names encode the category:
 *   "DpkD7R-SUPPORTED NPCs - DM Stash Aug _'26 Release - The Tales Grimm"
 *   "Sa2oLh-Terrain - Rapunzel's Cursed Tower"
 *   "4S2Bk3-DM Stash Sep _'26 Terrain Set - Shrine to Irinax"
 *   "OvbRiA-SUPPORTED Monsters & Bust - DM Stash June _'26 Release - ..."
 * A random 6-char prefix, then the category word (NPCs / Monsters / Terrain),
 * optionally with a "SUPPORTED " prefix and/or trailing words (" Set",
 * " & Bust"), then " - ". Browser (N) suffixes are tolerated.
 */
export function parseCategory(zipName: string): 'NPCs' | 'Monsters' | 'Terrain' | null {
  const m = zipName.match(/^[A-Za-z0-9]{6}-.*?\b(?:SUPPORTED\s+)?(NPCs|Monsters|Terrain)\b[^-]*-\s+/i)
  if (!m) return null
  const c = m[1].toLowerCase()
  return c === 'npcs' ? 'NPCs' : c === 'monsters' ? 'Monsters' : 'Terrain'
}

/** "Mallory - Supported" → "Mallory"; "Terrain - Rapunzel's Cursed Tower" → "Rapunzel's Cursed Tower" */
export function stripSupported(folderName: string): string {
  return folderName
    .replace(/\s*-\s*Supported\s*$/i, '')
    .replace(/^Terrain\s*-\s*/i, '')
    .trim()
}

/** Keep 32mm and prefix-less files (busts, terrain); drop other numeric scales. */
export function isScale32(filename: string): boolean {
  const m = filename.match(/^(\d+)_/)
  return !m || m[1] === '32'
}

/** The name token right before `_Body` in an STL filename, else null. */
export function figureToken(filename: string): string | null {
  const stem = filename.replace(/\.[^.]+$/, '')
  return stem.match(/_([A-Za-z0-9]+)_Body/i)?.[1] ?? null
}

/**
 * A model folder is a multi-figure unit only if two or more name tokens each
 * have BOTH a `_{token}_Body*` and a `_{token}_Base*` STL — i.e. each is a
 * complete standalone figure. A kitbash whose parts happen to include a
 * `_Tail_Body` (with no matching `_Tail_Base`) is not split. Returns the
 * qualifying figure tokens, or `[]` when there's fewer than two.
 */
export function splitFigures(stlNames: string[]): string[] {
  const bodies = new Set<string>()
  const bases = new Set<string>()
  for (const name of stlNames) {
    const stem = name.replace(/\.[^.]+$/, '')
    const b = stem.match(/_([A-Za-z0-9]+)_Body/i)?.[1]
    if (b) bodies.add(b)
    const a = stem.match(/_([A-Za-z0-9]+)_Base/i)?.[1]
    if (a) bases.add(a)
  }
  const figures = [...bodies].filter(t => bases.has(t))
  return figures.length >= 2 ? figures : []
}

function isModelFile(name: string): boolean {
  return MODEL_EXTS.test(name)
}

function isImageFile(name: string): boolean {
  return IMAGE_EXTS.test(name)
}

interface Dirent { name: string; isFile(): boolean; isDirectory(): boolean }

async function entriesOf(dir: string): Promise<Dirent[]> {
  let raw: Dirent[]
  try {
    raw = await readdir(dir, { withFileTypes: true })
  } catch (err) {
    // A path that simply isn't there (probing for an optional STL/ subdir) is
    // benign. Anything else -- EACCES, EIO on the NAS, ENAMETOOLONG -- would
    // silently drop models, so fail loud per the edge-case policy.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  return raw.filter(e => e.name !== '__MACOSX' && e.name !== '.DS_Store')
}

// ─── Profile ──────────────────────────────────────────────────────────────────

interface ModelCtx {
  packName: string
}

/** Find the folder that holds the STL files: STL/, "Unsupported (FDM)/", or the model folder itself. */
async function stlDirFor(modelPath: string): Promise<string> {
  for (const candidate of ['STL', 'Unsupported (FDM)']) {
    const p = join(modelPath, candidate)
    if ((await entriesOf(p)).some(e => e.isFile() && isModelFile(e.name))) return p
  }
  return modelPath
}

async function modelsFromFolder(
  modelPath: string,
  folderName: string,
  category: string,
  support: SupportType,
  ctx: ModelCtx,
  warnings: string[],
): Promise<ClassifiedModel[]> {
  const modelEntries = (await entriesOf(modelPath)).filter(e => e.isFile()).map(e => e.name)
  const images = modelEntries.filter(isImageFile)

  const stlDir = await stlDirFor(modelPath)
  const allStls = (await entriesOf(stlDir)).filter(e => e.isFile() && isModelFile(e.name)).map(e => e.name)
  const stls = allStls.filter(isScale32)

  if (stls.length === 0) {
    warnings.push(`"${folderName}" has no 32mm STL files -- skipped`)
    return []
  }

  const unit = stripSupported(folderName)
  const stlAbs = (f: string) => join(stlDir, f)
  const imgAbs = images.map(f => join(modelPath, f))

  const common = {
    packName: ctx.packName,
    scale: '32mm',
    category,
    supportType: support,
    sourceFolder: modelPath,
    imageFiles: imgAbs,
  }

  const figures = splitFigures(stls)
  if (figures.length >= 2) {
    const models: ClassifiedModel[] = []
    for (const fig of figures) {
      const figStls = stls.filter(f => f.includes(`_${fig}_`))
      models.push({ ...common, modelName: `${unit} - ${fig}`, files: figStls.map(stlAbs) })
    }
    const claimed = new Set(models.flatMap(m => m.files.map(p => p.split(/[\\/]/).at(-1)!)))
    for (const f of stls) {
      if (!claimed.has(f)) warnings.push(`"${unit}": STL "${f}" matched no figure -- left out`)
    }
    return models
  }

  return [{ ...common, modelName: unit, files: stls.map(stlAbs) }]
}

export const dmStashProfile: SubscriptionProfile = {
  name: 'DM Stash',

  filter: {
    include: ['ReadyToSlice'],
    includeFDM: true,
  },

  categoryMappings: {
    NPCs: { options: ['hero', 'npc'] },
    Monsters: { tag: 'monster' },
    Terrain: { tag: 'terrain' },
  },

  includesImages: true,

  formatPackFolder(packName: string): string {
    return packName
  },

  formatModelFolder(modelName: string): string {
    return modelName
  },

  async classify(rootFolder: string, originalInputPath?: string): Promise<ClassifyResult> {
    const releasePath = originalInputPath ?? rootFolder
    const ctx: ModelCtx = { packName: releasePath.split(/[\\/]/).filter(Boolean).at(-1) ?? '' }

    const models: ClassifiedModel[] = []
    const warnings: string[] = []

    for (const zipEntry of await entriesOf(rootFolder)) {
      if (!zipEntry.isDirectory()) continue
      const category = parseCategory(zipEntry.name)
      if (!category) {
        warnings.push(`unrecognised archive "${zipEntry.name}" -- no NPCs / Monsters / Terrain in the name, skipped`)
        continue
      }
      const support: SupportType = category === 'Terrain' ? 'FDM' : 'ReadyToSlice'
      const zipPath = join(rootFolder, zipEntry.name)

      for (const modelEntry of await entriesOf(zipPath)) {
        if (!modelEntry.isDirectory()) continue
        models.push(...await modelsFromFolder(
          join(zipPath, modelEntry.name), modelEntry.name, category, support, ctx, warnings,
        ))
      }
    }

    return { models, warnings }
  },
}
