import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { SubscriptionProfile, ClassifiedModel } from '../profiles/types.js'

export interface ClassificationResult {
  models: ClassifiedModel[]
  /** Root folder that was passed to the profile (inner wrapper if detected) */
  usedRoot: string
}

/**
 * Find the real root to classify from.
 * LootStudios ZIPs have an outer all-caps folder wrapping an inner properly-cased folder.
 * We want to use the inner one for extraction so pack/scale names are readable.
 */
async function resolveClassifyRoot(extractedRoot: string): Promise<string> {
  const entries = await readdir(extractedRoot, { withFileTypes: true })
  const dirs = entries.filter(e => e.isDirectory())

  // If there's exactly one subdirectory, descend into it (handle the ZIP wrapper)
  if (dirs.length === 1) {
    const inner = join(extractedRoot, dirs[0].name)
    const innerEntries = await readdir(inner, { withFileTypes: true })
    const innerDirs = innerEntries.filter(e => e.isDirectory())

    // If the single inner dir also contains dirs, that's likely the real root
    if (innerDirs.length > 0) {
      return inner
    }
  }

  return extractedRoot
}

export async function classify(
  extractedRoot: string,
  profile: SubscriptionProfile,
): Promise<ClassificationResult> {
  const usedRoot = await resolveClassifyRoot(extractedRoot)
  const models = await profile.classify(usedRoot)
  return { models, usedRoot }
}
