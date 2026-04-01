import type { ClassifiedModel, SubscriptionProfile } from '../profiles/types.js'

export interface FDMConflict {
  modelKey: string
  resin: ClassifiedModel
  fdm: ClassifiedModel
}

export interface FilterResult {
  /** Models that pass the filter and have no FDM conflict — ready to write */
  included: ClassifiedModel[]
  /** Models where both a filtered-in non-FDM variant AND an FDM variant exist — needs TUI resolution */
  fdmConflicts: FDMConflict[]
  /** Models filtered out entirely (Lychee, Unsupported, etc.) */
  skipped: ClassifiedModel[]
}

function modelKey(m: ClassifiedModel): string {
  return `${m.packName}|${m.scale}|${m.category}|${m.modelName}`
}

export function applyFilter(models: ClassifiedModel[], profile: SubscriptionProfile): FilterResult {
  const { include, includeFDM } = profile.filter

  const included: ClassifiedModel[] = []
  const skipped: ClassifiedModel[] = []

  // Separate into included vs skipped based on support type
  for (const model of models) {
    if (model.supportType === 'FDM') {
      if (includeFDM) included.push(model)
      else skipped.push(model)
    } else if (include.includes(model.supportType)) {
      included.push(model)
    } else {
      skipped.push(model)
    }
  }

  // Among included models, find FDM conflicts (same model has both FDM + non-FDM variant)
  const byKey = new Map<string, ClassifiedModel[]>()
  for (const model of included) {
    const key = modelKey(model)
    const existing = byKey.get(key) ?? []
    existing.push(model)
    byKey.set(key, existing)
  }

  const clean: ClassifiedModel[] = []
  const fdmConflicts: FDMConflict[] = []

  for (const [key, variants] of byKey) {
    const fdm = variants.find(m => m.supportType === 'FDM')
    const resin = variants.find(m => m.supportType !== 'FDM')

    if (fdm && resin) {
      fdmConflicts.push({ modelKey: key, resin, fdm })
    } else {
      clean.push(...variants)
    }
  }

  return { included: clean, fdmConflicts, skipped }
}
