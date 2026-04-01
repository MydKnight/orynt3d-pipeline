import { ensureDir, copy } from 'fs-extra'
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

      // Copy model files into the model folder
      for (const srcFile of model.files) {
        const filename = srcFile.split(/[\\/]/).at(-1)!
        await copy(srcFile, join(modelFolder, filename), { overwrite: false })
      }

      await writeModelConfig(modelFolder, model)
      written++
    } catch (err) {
      errors.push({ model, error: String(err) })
    }
  }

  return { written, errors }
}
