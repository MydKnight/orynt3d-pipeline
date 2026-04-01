import { describe, it, expect } from 'vitest'
import { applyFilter } from '../../src/pipeline/filter.js'
import { lootStudiosProfile } from '../../src/profiles/loot-studios.js'
import type { ClassifiedModel } from '../../src/profiles/types.js'

function makeModel(overrides: Partial<ClassifiedModel>): ClassifiedModel {
  return {
    packName: 'Greenbrooke Invasion',
    scale: '32mm',
    category: 'Enemies',
    modelName: 'Battering Beast',
    supportType: 'ReadyToSlice',
    sourceFolder: '/tmp/test',
    files: ['model.stl'],
    ...overrides,
  }
}

describe('applyFilter', () => {
  it('includes ReadyToSlice models', () => {
    const models = [makeModel({ supportType: 'ReadyToSlice' })]
    const { included, skipped, fdmConflicts } = applyFilter(models, lootStudiosProfile)
    expect(included).toHaveLength(1)
    expect(skipped).toHaveLength(0)
    expect(fdmConflicts).toHaveLength(0)
  })

  it('skips Lychee and Unsupported models', () => {
    const models = [
      makeModel({ supportType: 'Lychee' }),
      makeModel({ supportType: 'Unsupported' }),
    ]
    const { included, skipped } = applyFilter(models, lootStudiosProfile)
    expect(included).toHaveLength(0)
    expect(skipped).toHaveLength(2)
  })

  it('includes FDM models when includeFDM is true', () => {
    const models = [makeModel({ modelName: 'Halfling Facade', supportType: 'FDM' })]
    const { included } = applyFilter(models, lootStudiosProfile)
    expect(included).toHaveLength(1)
  })

  it('detects FDM conflict when same model has ReadyToSlice and FDM', () => {
    const models = [
      makeModel({ modelName: 'Halfling Facade', supportType: 'ReadyToSlice' }),
      makeModel({ modelName: 'Halfling Facade', supportType: 'FDM' }),
    ]
    const { included, fdmConflicts } = applyFilter(models, lootStudiosProfile)
    expect(included).toHaveLength(0)
    expect(fdmConflicts).toHaveLength(1)
    expect(fdmConflicts[0].resin.supportType).toBe('ReadyToSlice')
    expect(fdmConflicts[0].fdm.supportType).toBe('FDM')
  })

  it('no conflict when models differ by category', () => {
    const models = [
      makeModel({ category: 'Enemies', modelName: 'Halfling Facade', supportType: 'ReadyToSlice' }),
      makeModel({ category: 'Environment', modelName: 'Halfling Facade', supportType: 'FDM' }),
    ]
    const { included, fdmConflicts } = applyFilter(models, lootStudiosProfile)
    expect(fdmConflicts).toHaveLength(0)
    expect(included).toHaveLength(2)
  })

  it('no conflict when models have FDM but no ReadyToSlice equivalent', () => {
    const models = [makeModel({ modelName: 'Unique FDM Model', supportType: 'FDM' })]
    const { included, fdmConflicts } = applyFilter(models, lootStudiosProfile)
    expect(fdmConflicts).toHaveLength(0)
    expect(included).toHaveLength(1)
  })
})
