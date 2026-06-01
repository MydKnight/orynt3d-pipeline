import { describe, it, expect } from 'vitest'
import {
  extractSizeTag,
  parseFolderName,
  extractPackName,
} from '../../src/profiles/flesh-of-gods.js'

describe('extractSizeTag', () => {
  it('extracts named size from folder name', () => {
    expect(extractSizeTag('Enemy - Avatar Of Melancholy (Huge - 75 mm)')).toBe('huge')
    expect(extractSizeTag('Enemy - Shoggoth (Large - 50 mm)')).toBe('large')
    expect(extractSizeTag('Hero - Ava Naeronin (Medium - 25 mm)')).toBe('medium')
    expect(extractSizeTag('Enemy - Sprite (Small - 25 mm)')).toBe('small')
    expect(extractSizeTag('Enemy - Titan (Gargantuan - 100 mm)')).toBe('gargantuan')
  })

  it('returns null for legacy format without size word', () => {
    expect(extractSizeTag('Enemy - Arachvine (50 mm)')).toBeNull()
  })

  it('returns null when no size specifier present', () => {
    expect(extractSizeTag('Enemy - Some Monster')).toBeNull()
    expect(extractSizeTag('Bust - Draizan, Thirteenth Prophet')).toBeNull()
  })
})

describe('parseFolderName', () => {
  it('parses standard enemy folder', () => {
    expect(parseFolderName('Enemy - Corrupted Minotaur (Large - 50 mm)')).toEqual({
      type: 'Enemy',
      modelName: 'Corrupted Minotaur',
      sizeTag: 'large',
    })
  })

  it('parses hero folder with complex name', () => {
    expect(
      parseFolderName('Hero - Maelor, Rift-Count (Tiefling Chronurgy Wizard) (Medium - 25 mm)'),
    ).toEqual({
      type: 'Hero',
      modelName: 'Maelor, Rift-Count (Tiefling Chronurgy Wizard)',
      sizeTag: 'medium',
    })
  })

  it('parses NPC folder', () => {
    expect(parseFolderName('NPC - Village Elder (Small - 25 mm)')).toEqual({
      type: 'NPC',
      modelName: 'Village Elder',
      sizeTag: 'small',
    })
  })

  it('returns null sizeTag for legacy size format', () => {
    const result = parseFolderName('Enemy - Arachvine (50 mm)')
    expect(result).not.toBeNull()
    expect(result!.modelName).toBe('Arachvine')
    expect(result!.sizeTag).toBeNull()
  })

  it('returns null for Bust folders', () => {
    expect(parseFolderName('Bust - Draizan, Thirteenth Prophet')).toBeNull()
  })

  it('returns null when no type separator present', () => {
    expect(parseFolderName('SomeRandomFolder')).toBeNull()
  })

  it('returns null for unrecognised type prefix', () => {
    expect(parseFolderName('Animal - Giant Rat (Small - 25 mm)')).toBeNull()
  })
})

describe('extractPackName', () => {
  it('extracts and title-cases pack name from full release folder', () => {
    expect(extractPackName('1 - SINGLE DOWNLOAD - OCTOBER 2024 - THE CURSED MARSHES')).toBe(
      'The Cursed Marshes',
    )
  })

  it('handles throwback pack folder naming', () => {
    expect(
      extractPackName('2 - SINGLE DOWNLOAD - OCTOBER 2025 - FLESH OF GODS OCTOBER 25 THROWBACK PACK'),
    ).toBe('Flesh Of Gods October 25 Throwback Pack')
  })

  it('returns title-cased input when no separator present', () => {
    expect(extractPackName('THE DEVILS OFFSPRING')).toBe('The Devils Offspring')
  })
})
