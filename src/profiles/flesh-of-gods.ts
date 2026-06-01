import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { SubscriptionProfile, ClassifiedModel } from './types.js'

// ─── Extraction helpers (exported for unit testing) ───────────────────────────

const VALID_TYPES = new Set(['Enemy', 'Hero', 'NPC'])

// Matches both "(Large - 50 mm)" and legacy "(50 mm)" formats
const SIZE_RE = /\s+\((?:(Small|Medium|Large|Huge|Gargantuan) - )?\d+ mm\)$/

/** Extract the D&D size tag from a folder name, or null if absent/unrecognised */
export function extractSizeTag(folderName: string): string | null {
  const m = folderName.match(SIZE_RE)
  // m[1] is the size word — undefined for legacy "(50 mm)" format
  return m?.[1]?.toLowerCase() ?? null
}

/**
 * Parse a model folder name into { type, modelName, sizeTag }.
 * Returns null for Bust folders and folders that don't match the expected pattern.
 *
 * Examples:
 *   "Enemy - Corrupted Minotaur (Large - 50 mm)"   → { type: "Enemy", modelName: "Corrupted Minotaur", sizeTag: "large" }
 *   "Enemy - Arachvine (50 mm)"                    → { type: "Enemy", modelName: "Arachvine", sizeTag: null }
 *   "Hero - Maelor, Rift-Count (Tiefling Chronurgy Wizard) (Medium - 25 mm)"
 *                                                  → { type: "Hero",  modelName: "Maelor, Rift-Count (Tiefling Chronurgy Wizard)", sizeTag: "medium" }
 *   "Bust - Draizan, Thirteenth Prophet"           → null (busts skipped)
 */
export function parseFolderName(
  folderName: string,
): { type: string; modelName: string; sizeTag: string | null } | null {
  // Strip trailing size specifier first
  const sizeTag = extractSizeTag(folderName)
  const withoutSize = SIZE_RE.test(folderName) ? folderName.replace(SIZE_RE, '') : folderName

  // Must match "{Type} - {Name}"
  const sep = withoutSize.indexOf(' - ')
  if (sep === -1) return null

  const type = withoutSize.slice(0, sep)
  if (!VALID_TYPES.has(type)) return null   // skips Bust and anything else

  const modelName = withoutSize.slice(sep + 3).trim()
  if (!modelName) return null

  return { type, modelName, sizeTag }
}

/**
 * Extract the pack name from the release folder name.
 * Format: "{N} - SINGLE DOWNLOAD - {MONTH YEAR} - {PACK NAME}"
 * Returns title-cased pack name.
 */
export function extractPackName(releaseFolderName: string): string {
  const parts = releaseFolderName.split(' - ')
  const raw = parts.at(-1) ?? releaseFolderName
  return raw
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase())
}

// ─── Directory walking ─────────────────────────────────────────────────────────

const MODEL_FILE_EXTS = new Set(['.stl', '.3mf'])

async function findPresupportedDir(modelFolder: string): Promise<string | null> {
  const entries = await readdir(modelFolder, { withFileTypes: true })
  const dir = entries.find(
    e => e.isDirectory() && e.name.toUpperCase() === 'PRESUPPORTED',
  )
  return dir ? join(modelFolder, dir.name) : null
}

async function getPresupportedFiles(modelFolder: string): Promise<string[]> {
  const presupportedDir = await findPresupportedDir(modelFolder)
  if (!presupportedDir) return []
  let entries
  try {
    entries = await readdir(presupportedDir, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter(e => {
      if (!e.isFile()) return false
      const ext = e.name.slice(e.name.lastIndexOf('.')).toLowerCase()
      return MODEL_FILE_EXTS.has(ext)  // any .stl/.3mf — covers STL_, Hollowed_, etc.
    })
    .map(e => join(presupportedDir, e.name))
}

// ─── Profile ──────────────────────────────────────────────────────────────────

export const fleshOfGodsProfile: SubscriptionProfile = {
  name: 'Flesh of Gods',

  filter: {
    include: ['ReadyToSlice'],
    includeFDM: false,
  },

  categoryMappings: {
    Hero:  { tag: 'hero' },
    NPC:   { tag: 'npc' },
    Enemy: { options: ['monster', 'npc'] },
  },

  includesImages: true,

  formatPackFolder(packName: string, _scale: string): string {
    return packName
  },

  formatModelFolder(modelName: string): string {
    return modelName
  },

  async classify(rootFolder: string): Promise<ClassifiedModel[]> {
    const models: ClassifiedModel[] = []

    const rootName = rootFolder.split(/[\\/]/).at(-1) ?? ''
    const packName = extractPackName(rootName)
    const scale = '32mm'

    const entries = await readdir(rootFolder, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isDirectory()) continue

      // Skip the 75mm scale folder
      if (entry.name.toUpperCase().startsWith('75 MM')) continue

      const parsed = parseFolderName(entry.name)
      if (!parsed) {
        console.warn(`[FleshOfGods] Skipping unrecognised folder: ${entry.name}`)
        continue
      }

      const { type, modelName, sizeTag } = parsed
      const modelFolder = join(rootFolder, entry.name)
      const files = await getPresupportedFiles(modelFolder)

      if (files.length === 0) {
        console.warn(`[FleshOfGods] No presupported STL files found in: ${entry.name}`)
        continue
      }

      models.push({
        packName,
        scale,
        category: type,
        modelName,
        supportType: 'ReadyToSlice',
        sourceFolder: modelFolder,
        files,
        userTags: sizeTag ? [sizeTag] : undefined,
      })
    }

    return models
  },
}
