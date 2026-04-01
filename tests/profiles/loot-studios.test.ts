import { describe, it, expect } from 'vitest'
import {
  extractScale,
  extractPackName,
  extractCategory,
  extractSupportType,
  cleanModelName,
} from '../../src/profiles/loot-studios.js'

describe('extractScale', () => {
  it('extracts 32mm from root folder name', () => {
    expect(extractScale('ALL_GREENBROOKEINVASION_32MM')).toBe('32mm')
    expect(extractScale('All_GreenbrookeInvasion_32mm')).toBe('32mm')
  })

  it('extracts 75mm from root folder name', () => {
    expect(extractScale('All_SomePack_75mm')).toBe('75mm')
    expect(extractScale('ALL_SOMEPACK_75MM')).toBe('75mm')
  })

  it('returns null when no scale found', () => {
    expect(extractScale('RandomFolderName')).toBeNull()
  })
})

describe('extractPackName', () => {
  // NOTE: classify() uses the inner wrapper folder name (All_GreenbrookeInvasion_32mm),
  // not the outer all-caps folder (ALL_GREENBROOKEINVASION_32MM). The inner folder
  // always has proper casing in LootStudios' convention.
  it('strips All_ prefix and scale suffix', () => {
    expect(extractPackName('All_GreenbrookeInvasion_32mm')).toBe('Greenbrooke Invasion')
  })

  it('handles multi-word pack names starting with a single capital letter', () => {
    expect(extractPackName('All_ALightInTheShadow_32mm')).toBe('A Light In The Shadow')
  })

  it('handles already-spaced names', () => {
    expect(extractPackName('All_SomePack_75mm')).toBe('Some Pack')
  })
})

describe('extractCategory', () => {
  it('strips All_ prefix and _{Pack}_{Scale} suffix', () => {
    expect(extractCategory('All_Enemies_GreenbrookeInvasion_32mm')).toBe('Enemies')
    expect(extractCategory('All_Heroes_GreenbrookeInvasion_32mm')).toBe('Heroes')
    expect(extractCategory('All_Environment_GreenbrookeInvasion_32mm')).toBe('Environment')
    expect(extractCategory('All_Prop_GreenbrookeInvasion_32mm')).toBe('Prop')
  })

  it('returns null when pattern does not match', () => {
    expect(extractCategory('RandomFolder')).toBeNull()
  })
})

describe('extractSupportType', () => {
  it('maps _LYCHEE suffix to Lychee', () => {
    expect(extractSupportType('GreenbrookeInvasion_Enemies_32mm_LYCHEE')).toBe('Lychee')
  })

  it('maps _ReadyToSlice suffix to ReadyToSlice', () => {
    expect(extractSupportType('GreenbrookeInvasion_Enemies_32mm_ReadyToSlice')).toBe('ReadyToSlice')
  })

  it('maps _UnSupported suffix to Unsupported (case-insensitive)', () => {
    expect(extractSupportType('GreenbrookeInvasion_Enemies_32mm_UnSupported')).toBe('Unsupported')
    expect(extractSupportType('GreenbrookeInvasion_Enemies_32mm_Unsupported')).toBe('Unsupported')
  })

  it('maps _FDM suffix to FDM', () => {
    expect(extractSupportType('HalflingHomeFacade1_FDM')).toBe('FDM')
  })

  it('returns null when no support type found', () => {
    expect(extractSupportType('SomeRandomFolder')).toBeNull()
  })
})

describe('cleanModelName', () => {
  it('strips scale and support type suffix from model folder name', () => {
    expect(cleanModelName('BatteringBeast_32mm_LYCHEE')).toBe('Battering Beast')
    expect(cleanModelName('BatteringBeast_32mm_ReadyToSlice')).toBe('Battering Beast')
    expect(cleanModelName('BatteringBeast_32mm_UnSupported')).toBe('Battering Beast')
  })

  it('strips _FDM suffix', () => {
    expect(cleanModelName('HalflingHomeFacade1_FDM')).toBe('Halfling Home Facade 1')
  })

  it('splits CamelCase into words', () => {
    expect(cleanModelName('BelretTheCursedOne_32mm_ReadyToSlice')).toBe('Belret The Cursed One')
  })

  it('preserves numbers as part of words', () => {
    expect(cleanModelName('HalflingBarricade1_32mm_ReadyToSlice')).toBe('Halfling Barricade 1')
    expect(cleanModelName('HalflingHomeFacade2_FDM')).toBe('Halfling Home Facade 2')
  })
})
