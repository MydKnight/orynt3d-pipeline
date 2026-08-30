import { ensureDir, copy } from 'fs-extra'
import { readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ClassifiedModel, SubscriptionProfile } from '../profiles/types.js'
import {
  writeSubscriptionConfig,
  writePackConfig,
  writeModelConfig,
} from './config-writer.js'

export interface ReorganizeResult {
  written: number
  errors: Array<{ model: ClassifiedModel; error: string }>
}

export async function reorganize(
  models: ClassifiedModel[],
  profile: SubscriptionProfile,
  nasRoot: string,
): Promise<ReorganizeResult> {
  const subscriptionFolder = join(nasRoot, profile.name)
  await ensureDir(subscriptionFolder)
  await writeSubscriptionConfig(subscriptionFolder, profile.name)

  // Track which pack folders have already had their config written this run
  const writtenPackConfigs = new Set<string>()

  let written = 0
  const errors: ReorganizeResult['errors'] = []

  for (const model of models) {
    try {
      const packFolder = join(subscriptionFolder, profile.formatPackFolder(model.packName, model.scale))
      const categoryFolder = join(packFolder, model.category)
      const modelFolder = join(categoryFolder, profile.formatModelFolder(model.modelName))

      await ensureDir(modelFolder)

      if (!writtenPackConfigs.has(packFolder)) {
        await writePackConfig(packFolder, model.packName, model.scale)
        writtenPackConfigs.add(packFolder)
      }

      // Copy 3D model files
      for (const srcFile of model.files) {
        const filename = srcFile.split(/[\\/]/).at(-1)!
        await copy(srcFile, join(modelFolder, filename), { overwrite: false })
      }

      // Copy images if the subscription includes them in model folders
      if (profile.includesImages) {
        const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp'])
        if (model.imageFiles !== undefined) {
          // Curated list is authoritative — even when empty. Falling back to a
          // folder scan here would copy other models' images (e.g. every pose's
          // renders share one source folder).
          for (const src of model.imageFiles) {
            const filename = src.split(/[\\/]/).at(-1)!
            await copy(src, join(modelFolder, filename), { overwrite: false })
          }
        } else {
          const imgSrc = model.imageSourceFolder ?? model.sourceFolder
          const entries = await readdir(imgSrc, { withFileTypes: true })
          for (const entry of entries) {
            if (!entry.isFile()) continue
            const ext = entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase()
            if (!IMAGE_EXTS.has(ext)) continue
            await copy(join(imgSrc, entry.name), join(modelFolder, entry.name), { overwrite: false })
          }
        }
      }

      // Fetch image from URL if provided
      if (model.imageUrl) {
        try {
          const res = await fetch(model.imageUrl)
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const urlPath = model.imageUrl.split('?')[0]
          const lastSegment = urlPath.split('/').at(-1) ?? ''
          const extMatch = lastSegment.match(/\.([a-zA-Z0-9]{1,5})$/)
          const ext = extMatch?.[1] ?? 'jpg'
          const imgPath = join(modelFolder, `cover.${ext}`)
          const buf = Buffer.from(await res.arrayBuffer())
          await writeFile(imgPath, buf)
        } catch (err) {
          console.warn(`  [image] Failed to fetch for ${model.modelName}: ${err}`)
        }
      }

      await writeModelConfig(modelFolder, model)
      written++
    } catch (err) {
      errors.push({ model, error: String(err) })
    }
  }

  return { written, errors }
}
