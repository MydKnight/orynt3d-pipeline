import { describe, it, expect } from 'vitest'
import {
  parseCategory,
  stripSupported,
  isScale32,
  figureToken,
  splitFigures,
} from '../../src/profiles/dmstash.js'

describe('parseCategory', () => {
  it('reads the category out of a DM Stash ZIP name', () => {
    expect(parseCategory("DpkD7R-SUPPORTED NPCs - DM Stash Aug _'26 Release - The Tales Grimm")).toBe('NPCs')
    expect(parseCategory("LYbuKE-SUPPORTED Monsters - DM Stash Aug _'26 Release - The Tales Grimm")).toBe('Monsters')
    expect(parseCategory("Sa2oLh-Terrain - Rapunzel's Cursed Tower")).toBe('Terrain')
  })

  it('tolerates a browser (1) suffix', () => {
    expect(parseCategory("LYbuKE-SUPPORTED Monsters - DM Stash Aug _'26 Release - The Tales Grimm(1)")).toBe('Monsters')
  })

  it('returns null for anything it does not recognise', () => {
    expect(parseCategory('Some Random Folder')).toBeNull()
    expect(parseCategory('AbCdEf-Vehicles - Whatever')).toBeNull()
  })
})

describe('stripSupported', () => {
  it('drops a trailing " - Supported"', () => {
    expect(stripSupported('Mallory - Supported')).toBe('Mallory')
    expect(stripSupported('The Big Bad - Supported')).toBe('The Big Bad')
    expect(stripSupported('BUST Rook - Supported')).toBe('BUST Rook')
  })

  it('drops a leading "Terrain - "', () => {
    expect(stripSupported("Terrain - Rapunzel's Cursed Tower")).toBe("Rapunzel's Cursed Tower")
  })

  it('leaves an unadorned name alone', () => {
    expect(stripSupported('Undead Dwarven Brothers')).toBe('Undead Dwarven Brothers')
  })
})

describe('isScale32', () => {
  it('keeps 32mm and prefix-less files, drops other scales', () => {
    expect(isScale32('32_Supported_Mallory_Body.stl')).toBe(true)
    expect(isScale32('32_Took_Supported_Base.stl')).toBe(true)
    expect(isScale32('BUST_Supported_Rook_Body.stl')).toBe(true)
    expect(isScale32('Terrain_Unsupported_RapunzelTower_A1_Output.stl')).toBe(true)
    expect(isScale32('75_Supported_Mallory_Body.stl')).toBe(false)
    expect(isScale32('54_Supported_Whatever.stl')).toBe(false)
  })
})

describe('figureToken', () => {
  it('reads the name token before _Body', () => {
    expect(figureToken('32_Supported_Brook_Body.stl')).toBe('Brook')
    expect(figureToken('32_Supported_Feena_BodyWhole.stl')).toBe('Feena')
    expect(figureToken('32_Supported_Feena_BodyWinglessKeyed.stl')).toBe('Feena')
    expect(figureToken('32_Supported_Jabberwock_BodyCut.stl')).toBe('Jabberwock')
    expect(figureToken('32_Supported_Merlin_Body.stl')).toBe('Merlin')
  })

  it('returns null for non-body parts', () => {
    expect(figureToken('32_Supported_Mallory_Base.stl')).toBeNull()
    expect(figureToken('32_Supported_Merlin_SpellEffect.stl')).toBeNull()
  })
})

describe('splitFigures', () => {
  it('lists the tokens that have both a _Body and a _Base', () => {
    expect(splitFigures([
      '32_Supported_Brook_Base.stl', '32_Supported_Brook_Body.stl',
      '32_Supported_Crook_Base.stl', '32_Supported_Crook_Body.stl',
      '32_Supported_Mook_Base.stl', '32_Supported_Mook_Body.stl',
    ]).sort()).toEqual(['Brook', 'Crook', 'Mook'])
  })

  it('returns [] for a kitbash whose *_Body part has no matching _Base', () => {
    expect(splitFigures([
      '32_Supported_Jabberwock_Base.stl',
      '32_Supported_Jabberwock_BodyCut.stl',
      '32_Supported_Tail_Body.stl',
    ])).toEqual([])
  })

  it('returns [] for a single figure with body-option variants (Feena)', () => {
    expect(splitFigures([
      '32_Supported_Feena_Base.stl',
      '32_Supported_Feena_BodyWhole.stl',
      '32_Supported_Feena_BodyWinglessKeyed.stl',
    ])).toEqual([])
  })
})
