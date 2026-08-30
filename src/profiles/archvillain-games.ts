import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { SubscriptionProfile, ClassifiedModel } from './types.js'

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

// ─── Profile ──────────────────────────────────────────────────────────────────

interface ModelCtx {
  packName: string
  scale: string
}

/**
 * Turn one model folder (flat: STL/3MF + render images) into ClassifiedModels.
 * Multi-pose folders split into one model per pose; everything else is a single
 * (possibly kitbash) model.
 */
async function modelsFromFolder(folderPath: string, folderName: string, ctx: ModelCtx): Promise<ClassifiedModel[]> {
  const fileEntries = (await readdir(folderPath, { withFileTypes: true }))
    .filter(e => e.isFile())
    .map(e => e.name)

  const stls = fileEntries.filter(isModelFile)
  const images = fileEntries.filter(isImageFile)

  if (stls.length === 0) return []

  const base = stripPresupported(folderName)
  const posedStls = stls.filter(f => poseNumber(f) !== null)
  const out: ClassifiedModel[] = []

  if (posedStls.length > 0) {
    const byPose = new Map<string, string[]>()
    for (const f of posedStls) {
      const n = poseNumber(f)!
      const bucket = byPose.get(n) ?? []
      bucket.push(f)
      byPose.set(n, bucket)
    }
    for (const f of stls) {
      if (poseNumber(f) === null) {
        console.warn(`[Archvillain] Skipping un-numbered STL in multi-pose model "${base}": ${f}`)
      }
    }
    for (const [n, groupFiles] of [...byPose.entries()].sort()) {
      const poseImageNames = images.filter(img => poseNumber(img) === n)
      out.push({
        packName: ctx.packName,
        scale: ctx.scale,
        category: 'Models',
        modelName: poseModelName(base, n),
        supportType: 'ReadyToSlice',
        sourceFolder: folderPath,
        files: groupFiles.map(f => join(folderPath, f)),
        imageFiles: poseImageNames.map(img => join(folderPath, img)),
        userTags: tagsFor(poseImageNames),
      })
    }
  } else {
    out.push({
      packName: ctx.packName,
      scale: ctx.scale,
      category: 'Models',
      modelName: base,
      supportType: 'ReadyToSlice',
      sourceFolder: folderPath,
      files: stls.map(f => join(folderPath, f)),
      imageFiles: images.map(img => join(folderPath, img)),
      userTags: tagsFor(images),
    })
  }
  return out
}

function tagsFor(imageNames: string[]): string[] | undefined {
  const p = provenanceTag(imageNames)
  return p ? [p] : undefined
}

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

  async classify(rootFolder: string, originalInputPath?: string): Promise<ClassifiedModel[]> {
    const models: ClassifiedModel[] = []

    const releasePath = originalInputPath ?? rootFolder
    const ctx: ModelCtx = {
      packName: releasePath.split(/[\\/]/).filter(Boolean).at(-1) ?? '',
      scale: '32mm',
    }

    const topEntries = await readdir(rootFolder, { withFileTypes: true })

    for (const topEntry of topEntries) {
      if (!topEntry.isDirectory()) continue

      // Each top-level dir is one extracted archive with a single wrapper folder.
      const topPath = join(rootFolder, topEntry.name)
      const innerDirs = (await readdir(topPath, { withFileTypes: true }))
        .filter(e => e.isDirectory() && e.name !== '__MACOSX')
      if (innerDirs.length > 1) {
        console.warn(
          `[Archvillain] "${topEntry.name}" has multiple folders (${innerDirs.map(d => d.name).join(', ')}); ` +
          `using "${innerDirs[0].name}". Check the archive if models are missing.`,
        )
      }
      const wrapperPath = innerDirs[0] ? join(topPath, innerDirs[0].name) : topPath
      const wrapperName = innerDirs[0]?.name ?? topEntry.name

      const wrapperEntries = await readdir(wrapperPath, { withFileTypes: true })
      const wrapperHasModelFiles = wrapperEntries.some(e => e.isFile() && isModelFile(e.name))

      if (wrapperHasModelFiles) {
        // Individual-model archive: files sit directly in the wrapper.
        models.push(...await modelsFromFolder(wrapperPath, wrapperName, ctx))
      } else {
        // Compilation archive (Society / Bestiary): wrapper holds one folder per model.
        const modelDirs = wrapperEntries.filter(e => e.isDirectory() && e.name !== '__MACOSX')
        if (modelDirs.length === 0) {
          console.warn(`[Archvillain] No models found in: ${wrapperName}`)
          continue
        }
        for (const md of modelDirs) {
          models.push(...await modelsFromFolder(join(wrapperPath, md.name), md.name, ctx))
        }
      }
    }

    return models
  },
}
