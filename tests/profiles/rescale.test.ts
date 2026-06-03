import { describe, it, expect } from 'vitest'
import { parseCaseName, extractModelName, extractPoseName } from '../../src/profiles/rescale.js'

describe('parseCaseName', () => {
  it('splits standard PascalCase', () => {
    expect(parseCaseName('AbominableYeti')).toBe('Abominable Yeti')
    expect(parseCaseName('BlizzardTroll')).toBe('Blizzard Troll')
    expect(parseCaseName('ChromaticWhiteDragon')).toBe('Chromatic White Dragon')
  })

  it('handles consecutive capitals', () => {
    expect(parseCaseName('VargirNPC')).toBe('Vargir NPC')
  })

  it('leaves single-word names unchanged', () => {
    expect(parseCaseName('Thulgar')).toBe('Thulgar')
  })
})

describe('extractModelName', () => {
  it('strips _Supports suffix and PascalCase-splits', () => {
    expect(extractModelName('AbominableYeti_Supports')).toBe('Abominable Yeti')
    expect(extractModelName('ElementalDragon_Supports')).toBe('Elemental Dragon')
    expect(extractModelName('VargirRaider_Supports')).toBe('Vargir Raider')
  })

  it('strips Pack prefix before splitting', () => {
    expect(extractModelName('PackBlizzardTroll_Supports')).toBe('Blizzard Troll')
    expect(extractModelName('PackVargirFrosthorns_Supports')).toBe('Vargir Frosthorns')
    expect(extractModelName('PackWinterShardfangs_Supports')).toBe('Winter Shardfangs')
  })

  it('handles named models with proper nouns', () => {
    expect(extractModelName('IceGiantThulgar_Supports')).toBe('Ice Giant Thulgar')
  })
})

describe('extractPoseName', () => {
  it('strips _Supports and joins underscore segments', () => {
    expect(extractPoseName('BlizzardTroll_Stand_Supports')).toBe('Blizzard Troll Stand')
    expect(extractPoseName('BlizzardTroll_Wait_Supports')).toBe('Blizzard Troll Wait')
  })

  it('handles multi-word pose names', () => {
    expect(extractPoseName('VargirMage_CastingSpell_Supports')).toBe('Vargir Mage Casting Spell')
  })
})
