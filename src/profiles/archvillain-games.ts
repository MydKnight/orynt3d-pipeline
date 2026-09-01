import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { SubscriptionProfile, ClassifiedModel, ClassifyResult } from './types.js'

// ─── Extraction helpers (exported for unit testing) ───────────────────────────

const MODEL_EXTS = /\.(stl|3mf)$/i
const IMAGE_EXTS = /\.(jpe?g|png|webp)$/i

/** "Vaultsworn Zealot - Presupported" → "Vaultsworn Zealot" */
export function stripPresupported(name: string): string {
  return name.replace(/\s*-\s*presupported\s*$/i, '').trim()
}

/**
 * Pull the pose number out of a file name.
 *
 * Archvillain encodes poses as a zero-padded two-digit token:
 * - render images end with it: `...VaultswornZealot01.jpg` → "01"
 * - STL files carry it as an underscore segment: `STL_Zealot_01_base_scenic_supported.stl` → "01"
 * - kitbash part files (`STL_Khepresh_arm_l_supported.stl`, `...Khepresh.CloseUp.jpg`) have none → null
 *
 * Requiring exactly two digits keeps stray single digits (`_v2`, `CloseUp2`) from
 * being read as poses. A release that deviates from this convention is the user's
 * to rename (see Edge Case Policy).
 */
export function poseNumber(filename: string): string | null {
  const stem = filename.replace(/\.[^.]+$/, '')
  const trailing = stem.match(/(\d{2})$/)
  if (trailing) return trailing[1]
  const segment = stem.match(/_(\d{2})(?=[_.])/)
  if (segment) return segment[1]
  return null
}

/** "Vaultsworn Zealot" + "01" → "Vaultsworn Zealot 1" */
export function poseModelName(base: string, pose: string): string {
  return `${base} ${parseInt(pose, 10)}`
}

export function isModelFile(name: string): boolean {
  return MODEL_EXTS.test(name)
}

export function isImageFile(name: string): boolean {
  return IMAGE_EXTS.test(name)
}

/** An un-numbered STL that is a display base, not a body part. */
export function isBaseFile(name: string): boolean {
  // "base" as its own token (STL_Scion_base_scenic…), not a substring of a part
  // or model name ("Baseborn", "STL_Basework…").
  return /(^|[\s_-])base([\s._-]|$)/i.test(name)
}

/**
 * Society/Bestiary reprints carry an `AVS` / `AVB` marker in their render
 * filenames (`EoSVS.IndPres.AVS.Khalef.jpg`). Returns the provenance tag for a
 * set of image names, or null for the month's core themed models.
 */
export function provenanceTag(imageNames: string[]): 'society' | 'bestiary' | null {
  for (const n of imageNames) {
    if (/\.AVS\./i.test(n)) return 'society'
    if (/\.AVB\./i.test(n)) return 'bestiary'
  }
  return null
}

// ─── Structure walk ──────────────────────────────────────────────────────────

interface Dirent { name: string; isFile(): boolean; isDirectory(): boolean }

async function entriesOf(dir: string): Promise<Dirent[]> {
  let raw: Dirent[]
  try {
    raw = await readdir(dir, { withFileTypes: true })
  } catch (err) {
    // A directory that genuinely disappeared mid-walk is benign; anything else
    // (EACCES, ENAMETOOLONG on un-prefixed long Windows paths, EIO on the NAS)
    // would silently drop models, so fail loud per the edge-case policy.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  return raw.filter(e => e.name !== '__MACOSX' && e.name !== '.DS_Store')
}

/** Does this directory, or any directory beneath it, contain a model file? */
async function containsModelFiles(dir: string): Promise<boolean> {
  const entries = await entriesOf(dir)
  if (entries.some(e => e.isFile() && isModelFile(e.name))) return true
  for (const e of entries) {
    if (e.isDirectory() && await containsModelFiles(join(dir, e.name))) return true
  }
  return false
}

/**
 * Descend from `dir` to the folders that actually hold model files, whatever the
 * wrapper nesting (individual RAR → 1 wrapper; compilation RAR → 1-2 wrappers
 * then one folder per model; old flat imports → release/model). Pure containers
 * are traversed; a folder that both holds model files AND has sub-folders that
 * hold model files, or a folder with neither, is reported as a structural
 * warning rather than guessed at.
 */
async function* modelFolders(
  dir: string,
  name: string,
  warnings: string[],
): AsyncGenerator<{ path: string; name: string; entries: Dirent[] }> {
  const entries = await entriesOf(dir)
  const hasModelFiles = entries.some(e => e.isFile() && isModelFile(e.name))

  const modelSubdirs: string[] = []
  for (const e of entries) {
    if (e.isDirectory() && await containsModelFiles(join(dir, e.name))) modelSubdirs.push(e.name)
  }

  if (hasModelFiles && modelSubdirs.length > 0) {
    warnings.push(`"${name}" has model files and also sub-folders containing model files -- skipped (can't tell how to interpret it). Sub-folders: ${modelSubdirs.join(', ')}`)
    return
  }
  if (hasModelFiles) {
    yield { path: dir, name, entries }
    return
  }
  if (modelSubdirs.length > 0) {
    for (const sub of modelSubdirs) yield* modelFolders(join(dir, sub), sub, warnings)
    return
  }
  if (entries.some(e => e.isDirectory())) {
    warnings.push(`"${name}" has sub-folders but none contain model files -- skipped`)
  } else {
    warnings.push(`"${name}" contains no model files -- skipped`)
  }
}

// ─── Model classification ────────────────────────────────────────────────────

interface ModelCtx {
  packName: string
  scale: string
}

function tagsFor(imageNames: string[]): string[] | undefined {
  const p = provenanceTag(imageNames)
  return p ? [p] : undefined
}

/**
 * Turn one model folder (flat: STL/3MF + render images) into ClassifiedModels.
 *
 * - poses ≥ 2 and the numbered STLs outnumber the un-numbered *part* files
 *   (bases excluded): one model per pose. Un-numbered STLs (shared bases) and
 *   un-numbered images (a single group render) go into every pose.
 * - otherwise (single pose, or a kitbash centerpiece with a couple of numbered
 *   part-options among many parts): one model, all files.
 */
function modelsFromFolder(folderPath: string, folderName: string, ctx: ModelCtx, entries: Dirent[]): ClassifiedModel[] {
  const fileNames = entries.filter(e => e.isFile()).map(e => e.name)
  const stls = fileNames.filter(isModelFile)
  const images = fileNames.filter(isImageFile)
  if (stls.length === 0) return []

  const base = stripPresupported(folderName)
  const numbered = stls.filter(f => poseNumber(f) !== null)
  const unNumbered = stls.filter(f => poseNumber(f) === null)
  const parts = unNumbered.filter(f => !isBaseFile(f))
  const poses = [...new Set(numbered.map(f => poseNumber(f)!))].sort()

  const isKitbash = parts.length >= numbered.length
  const abs = (f: string) => join(folderPath, f)

  if (poses.length >= 2 && !isKitbash) {
    const sharedStls = unNumbered
    const sharedImgs = images.filter(i => poseNumber(i) === null)
    return poses.map(n => {
      const poseStls = numbered.filter(f => poseNumber(f) === n)
      const imgNames = [...images.filter(i => poseNumber(i) === n), ...sharedImgs]
      return {
        packName: ctx.packName,
        scale: ctx.scale,
        category: 'Models',
        modelName: poseModelName(base, n),
        supportType: 'ReadyToSlice',
        sourceFolder: folderPath,
        files: [...poseStls, ...sharedStls].map(abs),
        imageFiles: imgNames.map(abs),
        userTags: tagsFor(imgNames),
      }
    })
  }

  return [{
    packName: ctx.packName,
    scale: ctx.scale,
    category: 'Models',
    modelName: base,
    supportType: 'ReadyToSlice',
    sourceFolder: folderPath,
    files: stls.map(abs),
    imageFiles: images.map(abs),
    userTags: tagsFor(images),
  }]
}

// ─── Profile ──────────────────────────────────────────────────────────────────

export const archvillainGamesProfile: SubscriptionProfile = {
  name: 'Archvillain Games',

  filter: {
    include: ['ReadyToSlice'],
    includeFDM: false,
  },

  categoryMappings: {
    Models: { options: ['hero', 'npc', 'monster', 'terrain', 'prop'] },
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
    const ctx: ModelCtx = {
      packName: releasePath.split(/[\\/]/).filter(Boolean).at(-1) ?? '',
      scale: '32mm',
    }

    const models: ClassifiedModel[] = []
    const warnings: string[] = []

    for await (const mf of modelFolders(rootFolder, ctx.packName, warnings)) {
      models.push(...modelsFromFolder(mf.path, mf.name, ctx, mf.entries))
    }

    return { models, warnings }
  },
}
