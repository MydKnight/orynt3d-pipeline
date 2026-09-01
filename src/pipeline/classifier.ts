import type { SubscriptionProfile, ClassifiedModel } from '../profiles/types.js'

export interface ClassificationResult {
  models: ClassifiedModel[]
  usedRoot: string
  /** Folders the profile skipped as structurally ambiguous. */
  warnings: string[]
}

export async function classify(
  extractedRoot: string,
  profile: SubscriptionProfile,
  originalInputPath?: string,
): Promise<ClassificationResult> {
  const result = await profile.classify(extractedRoot, originalInputPath)
  const models = Array.isArray(result) ? result : result.models
  const warnings = Array.isArray(result) ? [] : result.warnings
  return { models, usedRoot: extractedRoot, warnings }
}
