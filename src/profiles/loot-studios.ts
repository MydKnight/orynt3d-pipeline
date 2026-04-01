import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { SubscriptionProfile, ClassifiedModel, SupportType } from './types.js'

// ─── Extraction helpers (exported for unit testing) ───────────────────────────

const SCALE_RE = /_(32mm|75mm|28mm|54mm|90mm|120mm)$/i

export function extractScale(folderName: string): string | null {
  const m = folderName.match(SCALE_RE)
  return m ? m[1].toLowerCase() : null
}

export function extractPackName(rootFolderName: string): string {
  // Strip leading "All_" or "ALL_" (case-insensitive)
  let name = rootFolderName.replace(/^All_/i, '')
  // Strip trailing scale suffix
  name = name.replace(SCALE_RE, '')
  // Split CamelCase / PascalCase into words
  return splitCamelCase(name)
}

export function extractCategory(categoryFolderName: string): string | null {
  // Pattern: All_{Category}_{Pack}_{Scale}
  const m = categoryFolderName.match(/^All_([A-Za-z]+)_/i)
  if (!m) return null
  return m[1]
}

const SUPPORT_SUFFIXES: Record<string, SupportType> = {
  lychee: 'Lychee',
  readytoslice: 'ReadyToSlice',
  unsupported: 'Unsupported',
  fdm: 'FDM',
}

export function extractSupportType(folderName: string): SupportType | null {
  // Match the last underscore-separated segment
  const m = folderName.match(/_([A-Za-z]+)$/)
  if (!m) return null
  const key = m[1].toLowerCase()
  return SUPPORT_SUFFIXES[key] ?? null
}

export function cleanModelName(modelFolderName: string): string {
  // Strip support type suffix (e.g. _LYCHEE, _ReadyToSlice, _UnSupported, _FDM)
  let name = modelFolderName.replace(/_(?:LYCHEE|ReadyToSlice|UnSupported|Unsupported|FDM)$/i, '')
  // Strip scale suffix (e.g. _32mm)
  name = name.replace(SCALE_RE, '')
  return splitCamelCase(name)
}

/** Split PascalCase/CamelCase into space-separated words, keeping numbers attached to preceding word */
function splitCamelCase(str: string): string {
  return str
    // Insert space between two caps where second is followed by lowercase: "ALightIn" → "A Light In"
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    // Insert space before uppercase letters that follow lowercase letters or digits
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    // Insert space before sequences of digits that follow letters
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    // Replace underscores with spaces
    .replace(/_/g, ' ')
    .trim()
}

// ─── Directory walking ─────────────────────────────────────────────────────────

const MODEL_FILE_EXTS = new Set(['.stl', '.3mf', '.obj'])

async function getModelFiles(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { withFileTypes: true })
  return entries
    .filter(e => e.isFile() && MODEL_FILE_EXTS.has(e.name.slice(e.name.lastIndexOf('.')).toLowerCase()))
    .map(e => join(folder, e.name))
}

// ─── Profile ──────────────────────────────────────────────────────────────────

export const lootStudiosProfile: SubscriptionProfile = {
  name: 'Loot Studios',

  filter: {
    include: ['ReadyToSlice'],
    includeFDM: true,
  },

  formatPackFolder(packName: string, scale: string): string {
    // e.g. "Greenbrooke Invasion" + "32mm" → "GreenbrookeInvasion_32mm"
    return packName.replace(/ /g, '') + '_' + scale
  },

  formatModelFolder(modelName: string): string {
    return modelName
  },

  async classify(rootFolder: string): Promise<ClassifiedModel[]> {
    const models: ClassifiedModel[] = []

    // Root folder name tells us pack + scale
    const rootName = rootFolder.split(/[\\/]/).at(-1) ?? ''
    const scale = extractScale(rootName)
    const packName = extractPackName(rootName)

    if (!scale) {
      console.warn(`[LootStudios] Could not extract scale from root folder: ${rootName}`)
    }

    // resolveClassifyRoot already unwrapped to All_{Pack}_{Scale}/.
    // Every direct child here should be a category folder: All_{Category}_{Pack}_{Scale}/
    const walkCategories = async (dir: string): Promise<void> => {
      const entries = await readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const fullPath = join(dir, entry.name)
        const category = extractCategory(entry.name)
        if (!category) {
          console.warn(`[LootStudios] Unrecognised category folder: ${entry.name}`)
          continue
        }
        await walkSupportType(fullPath, category)
      }
    }

    const walkSupportType = async (categoryDir: string, category: string): Promise<void> => {
      const entries = await readdir(categoryDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const supportType = extractSupportType(entry.name)
        if (!supportType) {
          console.warn(`[LootStudios] Unrecognised support-type folder: ${entry.name}`)
          continue
        }
        const supportTypeDir = join(categoryDir, entry.name)
        await walkModelFolders(supportTypeDir, category, supportType)
      }
    }

    const walkModelFolders = async (
      supportTypeDir: string,
      category: string,
      supportType: SupportType,
    ): Promise<void> => {
      const entries = await readdir(supportTypeDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const modelFolder = join(supportTypeDir, entry.name)
        const files = await getModelFiles(modelFolder)
        if (files.length === 0) continue

        models.push({
          packName,
          scale: scale ?? 'unknown',
          category,
          modelName: cleanModelName(entry.name),
          supportType,
          sourceFolder: modelFolder,
          files,
        })
      }
    }

    await walkCategories(rootFolder)
    return models
  },
}
