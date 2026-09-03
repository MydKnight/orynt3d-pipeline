import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { dmStashProfile as profile } from '../../src/profiles/dmstash.js'
import type { ClassifyResult } from '../../src/profiles/types.js'

let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'dms-')) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

async function tree(...paths: string[]) {
  for (const p of paths) {
    const abs = join(root, p)
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, '')
  }
}

const run = () => profile.classify(root, join('/downloads', 'The Tales Grimm')) as Promise<ClassifyResult>
const names = (r: ClassifyResult) => r.models.map(m => m.modelName).sort()
const model = (r: ClassifyResult, n: string) => r.models.find(m => m.modelName === n)!
const files = (r: ClassifyResult, n: string) => model(r, n).files.map(f => f.split(/[\\/]/).at(-1)).sort()

const NPC_ZIP = "DpkD7R-SUPPORTED NPCs - DM Stash Aug _'26 Release - The Tales Grimm"
const MON_ZIP = "LYbuKE-SUPPORTED Monsters - DM Stash Aug _'26 Release - The Tales Grimm(1)"
const TER_ZIP = "Sa2oLh-Terrain - Rapunzel's Cursed Tower"

describe('dmstash classify — structure', () => {
  it('single-figure NPC: STL/ subfolder, 32mm only, one model', async () => {
    await tree(
      `${NPC_ZIP}/Mallory - Supported/Mallory the Envious - The Dark Ruler.jpg`,
      `${NPC_ZIP}/Mallory - Supported/LYS/32_Supported_Mallory_Body.lys`,
      `${NPC_ZIP}/Mallory - Supported/STL/32_Supported_Mallory_Base.stl`,
      `${NPC_ZIP}/Mallory - Supported/STL/32_Supported_Mallory_Body.stl`,
      `${NPC_ZIP}/Mallory - Supported/STL/75_Supported_Mallory_Base.stl`,
      `${NPC_ZIP}/Mallory - Supported/STL/75_Supported_Mallory_Body.stl`,
      `${NPC_ZIP}/August 26 RPG Pack - Names.jpg`,
    )
    const r = await run()
    expect(r.warnings).toEqual([])
    expect(names(r)).toEqual(['Mallory'])
    expect(files(r, 'Mallory')).toEqual(['32_Supported_Mallory_Base.stl', '32_Supported_Mallory_Body.stl'])
    expect(model(r, 'Mallory').supportType).toBe('ReadyToSlice')
    expect(model(r, 'Mallory').category).toBe('NPCs')
    expect(model(r, 'Mallory').imageFiles.length).toBe(1)
  })

  it('BUST: no scale prefix, kept', async () => {
    await tree(
      `${MON_ZIP}/BUST Rook - Supported/Rook - Bust.jpg`,
      `${MON_ZIP}/BUST Rook - Supported/STL/BUST_Supported_Rook_Base.stl`,
      `${MON_ZIP}/BUST Rook - Supported/STL/BUST_Supported_Rook_Whole.stl`,
    )
    const r = await run()
    expect(names(r)).toEqual(['BUST Rook'])
    expect(files(r, 'BUST Rook')).toEqual(['BUST_Supported_Rook_Base.stl', 'BUST_Supported_Rook_Whole.stl'])
    // Monsters auto-tags via categoryMappings, not via classify()
    expect(model(r, 'BUST Rook').category).toBe('Monsters')
    expect(profile.categoryMappings.Monsters.tag).toBe('monster')
  })

  it('multi-figure Monsters folder splits by figure, render shared', async () => {
    const base = `${MON_ZIP}/Undead Dwarven Brothers - Supported`
    await tree(
      `${base}/Undead Dwarven Brothers.jpg`,
      `${base}/STL/32_Supported_Brook_Base.stl`,
      `${base}/STL/32_Supported_Brook_Body.stl`,
      `${base}/STL/32_Supported_Crook_Base.stl`,
      `${base}/STL/32_Supported_Crook_Body.stl`,
      `${base}/STL/32_Supported_Mook_Base.stl`,
      `${base}/STL/32_Supported_Mook_Body.stl`,
      `${base}/STL/75_Supported_Brook_Body.stl`,
    )
    const r = await run()
    expect(r.warnings).toEqual([])
    expect(names(r)).toEqual([
      'Undead Dwarven Brothers - Brook',
      'Undead Dwarven Brothers - Crook',
      'Undead Dwarven Brothers - Mook',
    ])
    expect(files(r, 'Undead Dwarven Brothers - Brook')).toEqual([
      '32_Supported_Brook_Base.stl', '32_Supported_Brook_Body.stl',
    ])
    expect(r.models.every(m => m.imageFiles.length === 1)).toBe(true)
  })

  it('kitbash with a *_Body part does NOT split (figure needs a matching _Base)', async () => {
    const base = `${MON_ZIP}/Jabberwock - Supported`
    await tree(
      `${base}/The Jabberwock.jpg`,
      `${base}/STL/32_Supported_Jabberwock_Base.stl`,
      `${base}/STL/32_Supported_Jabberwock_BodyCut.stl`,
      `${base}/STL/32_Supported_Jabberwock_Head.stl`,
      `${base}/STL/32_Supported_Tail_Body.stl`,
    )
    const r = await run()
    expect(r.warnings).toEqual([])
    expect(names(r)).toEqual(['Jabberwock'])
    expect(files(r, 'Jabberwock').length).toBe(4)
  })

  it('Terrain: "Unsupported (FDM)" folder, FDM support type, terrain tag', async () => {
    const base = `${TER_ZIP}/Terrain - Rapunzel's Cursed Tower`
    await tree(
      `${base}/Rapunzel's Cursed Tower - Dice Tower.jpg`,
      `${base}/Unsupported (FDM)/Terrain_Unsupported_RapunzelBase_A_Output.stl`,
      `${base}/Unsupported (FDM)/Terrain_Unsupported_RapunzelTower_A1_Output.stl`,
    )
    const r = await run()
    expect(names(r)).toEqual(["Rapunzel's Cursed Tower"])
    expect(model(r, "Rapunzel's Cursed Tower").supportType).toBe('FDM')
    expect(model(r, "Rapunzel's Cursed Tower").category).toBe('Terrain')
    expect(profile.categoryMappings.Terrain.tag).toBe('terrain')
    expect(files(r, "Rapunzel's Cursed Tower").length).toBe(2)
  })

  it('double-wrapped model: "{Name} - Supported/Supported/STL/..." still classifies', async () => {
    const base = `${NPC_ZIP}/Professor Margaux - Supported`
    await tree(
      `${base}/Professor Margaux.jpg`,
      `${base}/Supported/STL/32_Supported_Margaux_Base.stl`,
      `${base}/Supported/STL/32_Supported_Margaux_Body.stl`,
      `${base}/Supported/STL/75_Supported_Margaux_Body.stl`,
    )
    const r = await run()
    expect(r.warnings).toEqual([])
    expect(names(r)).toEqual(['Professor Margaux'])
    expect(files(r, 'Professor Margaux')).toEqual([
      '32_Supported_Margaux_Base.stl', '32_Supported_Margaux_Body.stl',
    ])
    expect(model(r, 'Professor Margaux').imageFiles.length).toBe(1)
  })

  it('warns on an archive whose name has no recognised category', async () => {
    await tree('AbCdEf-Vehicles - Whatever/Car - Supported/STL/32_Supported_Car_Body.stl')
    const r = await run()
    expect(r.models).toEqual([])
    expect(r.warnings[0]).toMatch(/unrecognised archive/)
  })
})
