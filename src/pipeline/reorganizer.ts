import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ClassifiedModel, SubscriptionProfile } from '../profiles/types.js'
import { writeModelConfig } from './config-writer.js'
import { resilientCopy } from './resilient-copy.js'

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp'])
const basename = (p: string) => p.split(/[\\/]/).at(-1)!

export interface ReorganizeResult {
  /** Models whose every file was staged. */
  staged: number
  /** Models with one or more files that could not be staged even after retries. */
  incomplete: Array<{ model: string; failed: string[] }>
  /** Where the organised tree was written. */
  stagingRoot: string
}

/**
 * Build the organised folder tree for a subscription in a LOCAL staging
 * directory. No network. `syncToNas()` transfers the result to the NAS.
 *
 * Per-file copies go through `resilientCopy` (size-skip + atomic temp/rename),
 * so re-running over an existing staging dir is nearly free and never leaves a
 * half-written file. A file that still fails after retries is recorded; the rest
 * of that model's files still copy, and its `config.orynt3d` is written only if
 * everything landed.
 */
export async function reorganize(
  models: ClassifiedModel[],
  profile: SubscriptionProfile,
  stagingRoot: string,
): Promise<ReorganizeResult> {
  const subscriptionFolder = join(stagingRoot, profile.name)
  await mkdir(subscriptionFolder, { recursive: true })

  let staged = 0
  const incomplete: ReorganizeResult['incomplete'] = []

  for (let i = 0; i < models.length; i++) {
    const model = models[i]
    console.log(`  [${i + 1}/${models.length}] ${model.modelName}`)

    const failed: string[] = []

    // Per-model error boundary: a bad folder name, an unreadable image source,
    // or a config-write failure for one model must not abort the whole run.
    // Edge Case Policy: log a clear warning and skip.
    try {
      const packFolder = join(subscriptionFolder, profile.formatPackFolder(model.packName, model.scale))
      const categoryFolder = join(packFolder, model.category)
      const modelFolder = join(categoryFolder, profile.formatModelFolder(model.modelName))
      await mkdir(modelFolder, { recursive: true })

      const copyInto = async (srcFile: string) => {
        try {
          await resilientCopy(srcFile, join(modelFolder, basename(srcFile)))
        } catch (err) {
          failed.push(`${basename(srcFile)} (${err})`)
        }
      }

      for (const srcFile of model.files) await copyInto(srcFile)

      if (profile.includesImages) {
        if (model.imageFiles !== undefined) {
          // Curated list is authoritative — even when empty. A folder scan here
          // would pull in other models' renders (one source folder per pose set).
          for (const img of model.imageFiles) await copyInto(img)
        } else {
          const imgSrc = model.imageSourceFolder ?? model.sourceFolder
          const entries = await readdir(imgSrc, { withFileTypes: true })
          for (const entry of entries) {
            if (!entry.isFile()) continue
            const ext = entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase()
            if (IMAGE_EXTS.has(ext)) await copyInto(join(imgSrc, entry.name))
          }
        }
      }

      if (model.imageUrl) {
        try {
          const res = await fetch(model.imageUrl)
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const lastSegment = model.imageUrl.split('?')[0].split('/').at(-1) ?? ''
          const ext = lastSegment.match(/\.([a-zA-Z0-9]{1,5})$/)?.[1] ?? 'jpg'
          await writeFile(join(modelFolder, `cover.${ext}`), Buffer.from(await res.arrayBuffer()))
        } catch (err) {
          console.warn(`      [image] failed to fetch for ${model.modelName}: ${err}`)
        }
      }

      if (failed.length > 0) {
        incomplete.push({ model: model.modelName, failed })
      } else {
        await writeModelConfig(modelFolder, model)
        staged++
      }
    } catch (err) {
      failed.push(`model could not be staged (${err})`)
      incomplete.push({ model: model.modelName, failed })
    }
  }

  return { staged, incomplete, stagingRoot: subscriptionFolder }
}
