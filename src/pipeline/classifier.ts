import type { SubscriptionProfile, ClassifiedModel } from '../profiles/types.js'

export interface ClassificationResult {
  models: ClassifiedModel[]
  usedRoot: string
}

export async function classify(
  extractedRoot: string,
  profile: SubscriptionProfile,
): Promise<ClassificationResult> {
  const models = await profile.classify(extractedRoot)
  return { models, usedRoot: extractedRoot }
}
