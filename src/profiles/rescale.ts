import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { SubscriptionProfile, ClassifiedModel } from './types.js'

// ─── Extraction helpers (exported for unit testing) ───────────────────────────

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp'])
const MODEL_EXTS = new Set(['.stl', '.3mf'])

/**
 * Convert PascalCase to spaced title case.
 * "AbominableYeti" → "Abominable Yeti"
 * "VargirFrosthorns" → "Vargir Frosthorns"
 */
export function parseCaseName(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim()
}

/**
 * Derive a clean model name from a ZIP base name (without .zip).
 * Strips "Pack" prefix and "_Supports" suffix, PascalCase-splits the result.
 *
 * "AbominableYeti_Supports"    → "Abominable Yeti"
 * "PackBlizzardTroll_Supports" → "Blizzard Troll"
 * "IceGiantThulgar_Supports"   → "Ice Giant Thulgar"
 */
export function extractModelName(zipBaseName: string): string {
  let name = zipBaseName
  if (name.startsWith('Pack')) name = name.slice(4)
  name = name.replace(/_Supports$/i, '')
  return name
    .split('_')
    .map(part => parseCaseName(part))
    .filter(Boolean)
    .join(' ')
    .trim()
}

/**
 * Derive a pose model name from a Pack pose folder name.
 * "BlizzardTroll_Stand_Supports" → "Blizzard Troll Stand"
 * "BlizzardTroll_Wait_Supports"  → "Blizzard Troll Wait"
 */
export function extractPoseName(poseFolderName: string): string {
  const name = poseFolderName.replace(/_Supports$/i, '')
  return name
    .split('_')
    .map(part => parseCaseName(part))
    .filter(Boolean)
    .join(' ')
    .trim()
}

async function getFiles(folder: string, exts: Set<string>): Promise<string[]> {
  let entries
  try {
    entries = await readdir(folder, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter(e => e.isFile() && exts.has(e.name.slice(e.name.lastIndexOf('.')).toLowerCase()))
    .map(e => join(folder, e.name))
}

/**
 * STL/3MF files for a model folder, skipping Beefed variants.
 * Two structures exist across Rescale releases:
 * - Subfolder: files live in Supported/ (BlizzardTroll style)
 * - Flat: files sit directly in the folder with _Sup.stl / _Bef.stl suffixes (VargirMage style)
 */
async function getModelFiles(modelFolder: string): Promise<string[]> {
  const fromSubfolder = await getFiles(join(modelFolder, 'Supported'), MODEL_EXTS)
  if (fromSubfolder.length > 0) return fromSubfolder

  const all = await getFiles(modelFolder, MODEL_EXTS)
  return all.filter(f => {
    const base = (f.split(/[\\/]/).at(-1) ?? '').replace(/\.[^.]+$/, '')
    return base.endsWith('_Sup')
  })
}

/**
 * Find the image source folder for a model folder.
 * Checks Renders/ subfolder first (single models), then the folder itself (Pack group image).
 * Returns the folder that actually contains images, or null if none found.
 */
export async function findImageFolder(folder: string): Promise<string | null> {
  const rendersDir = join(folder, 'Renders')
  const fromRenders = await getFiles(rendersDir, IMAGE_EXTS)
  if (fromRenders.length > 0) return rendersDir
  const fromRoot = await getFiles(folder, IMAGE_EXTS)
  if (fromRoot.length > 0) return folder
  return null
}

// ─── Profile ──────────────────────────────────────────────────────────────────

export const rescaleProfile: SubscriptionProfile = {
  name: 'Rescale',

  filter: {
    include: ['ReadyToSlice'],
    includeFDM: false,
  },

  categoryMappings: {
    Models: { options: ['hero', 'monster', 'npc', 'terrain', 'scatter', 'building', 'prop'] },
  },

  includesImages: true,

  formatPackFolder(packName: string, _scale: string): string {
    return packName
  },

  formatModelFolder(modelName: string): string {
    return modelName
  },

  async classify(rootFolder: string, originalInputPath?: string): Promise<ClassifiedModel[]> {
    const models: ClassifiedModel[] = []

    const releasePath = originalInputPath ?? rootFolder
    const packName = releasePath.split(/[\\/]/).filter(Boolean).at(-1) ?? ''
    const scale = '32mm'

    const topEntries = await readdir(rootFolder, { withFileTypes: true })

    for (const topEntry of topEntries) {
      if (!topEntry.isDirectory()) continue

      // Each top-level dir is a single ZIP's extracted content.
      // It contains exactly one inner wrapper folder.
      const destDir = join(rootFolder, topEntry.name)
      const innerEntries = await readdir(destDir, { withFileTypes: true })
      const innerDirEntry = innerEntries.find(e => e.isDirectory())
      if (!innerDirEntry) {
        console.warn(`[Rescale] No inner directory in: ${topEntry.name}`)
        continue
      }

      const innerPath = join(destDir, innerDirEntry.name)
      const innerContents = await readdir(innerPath, { withFileTypes: true })
      const innerDirs = innerContents.filter(e => e.isDirectory())

      const hasSupported = innerDirs.some(e => e.name === 'Supported')
      const poseSubfolders = innerDirs.filter(e => /^.+_Supports$/i.test(e.name))
      const isPack = !hasSupported && poseSubfolders.length > 0

      if (!isPack) {
        // ── Single model ──────────────────────────────────────────────────────
        const modelName = extractModelName(topEntry.name)
        const files = await getModelFiles(innerPath)
        if (files.length === 0) {
          console.warn(`[Rescale] No STL files in Supported/ for: ${topEntry.name}`)
          continue
        }
        const imageSourceFolder = await findImageFolder(innerPath) ?? undefined

        models.push({
          packName,
          scale,
          category: 'Models',
          modelName,
          supportType: 'ReadyToSlice',
          sourceFolder: innerPath,
          files,
          imageSourceFolder,
        })
      } else {
        // ── Pack — multiple pose variants ─────────────────────────────────────
        const groupImageFolder = await findImageFolder(innerPath) ?? undefined

        for (const poseEntry of poseSubfolders) {
          const posePath = join(innerPath, poseEntry.name)
          const poseName = extractPoseName(poseEntry.name)
          const files = await getModelFiles(posePath)
          if (files.length === 0) {
            console.warn(`[Rescale] No STL files in Supported/ for pose: ${poseEntry.name}`)
            continue
          }

          models.push({
            packName,
            scale,
            category: 'Models',
            modelName: poseName,
            supportType: 'ReadyToSlice',
            sourceFolder: posePath,
            files,
            imageSourceFolder: groupImageFolder,
          })
        }
      }
    }

    return models
  },
}
