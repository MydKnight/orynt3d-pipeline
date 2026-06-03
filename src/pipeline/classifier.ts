import type { SubscriptionProfile, ClassifiedModel } from '../profiles/types.js'

export interface ClassificationResult {
  models: ClassifiedModel[]
  usedRoot: string
}

export async function classify(
  extractedRoot: string,
  profile: SubscriptionProfile,
  originalInputPath?: string,
): Promise<ClassificationResult> {
  const models = await profile.classify(extractedRoot, originalInputPath)
  return { models, usedRoot: extractedRoot }
}
