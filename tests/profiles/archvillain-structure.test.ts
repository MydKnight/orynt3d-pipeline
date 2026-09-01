import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { archvillainGamesProfile as profile } from '../../src/profiles/archvillain-games.js'
import type { ClassifyResult } from '../../src/profiles/types.js'

let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'avg-')) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

/** Build the tree the extractor would produce, from a list of relative file paths. */
async function tree(...paths: string[]) {
  for (const p of paths) {
    const abs = join(root, p)
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, '')
  }
}

const run = () => profile.classify(root, join('/downloads', 'Some Release')) as Promise<ClassifyResult>
const names = (r: ClassifyResult) => r.models.map(m => m.modelName).sort()
const filesOf = (r: ClassifyResult, name: string) =>
  r.models.find(m => m.modelName === name)!.files.map(f => f.split(/[\\/]/).at(-1)).sort()

describe('archvillain classify — structure', () => {
  it('individual archive: single wrapper, multi-pose unit', async () => {
    await tree(
      'Vaultsworn Zealot - Presupported/Vaultsworn Zealot - Presupported/STL_Zealot_01_supported.stl',
      'Vaultsworn Zealot - Presupported/Vaultsworn Zealot - Presupported/STL_Zealot_01_base_scenic_supported.stl',
      'Vaultsworn Zealot - Presupported/Vaultsworn Zealot - Presupported/STL_Zealot_02_supported.stl',
      'Vaultsworn Zealot - Presupported/Vaultsworn Zealot - Presupported/STL_Zealot_02_base_scenic_supported.stl',
      'Vaultsworn Zealot - Presupported/Vaultsworn Zealot - Presupported/EoSVS.IndPres.VaultswornZealot01.jpg',
      'Vaultsworn Zealot - Presupported/Vaultsworn Zealot - Presupported/EoSVS.IndPres.VaultswornZealot02.jpg',
    )
    const r = await run()
    expect(r.warnings).toEqual([])
    expect(names(r)).toEqual(['Vaultsworn Zealot 1', 'Vaultsworn Zealot 2'])
    expect(filesOf(r, 'Vaultsworn Zealot 1')).toEqual(['STL_Zealot_01_base_scenic_supported.stl', 'STL_Zealot_01_supported.stl'])
  })

  it('kitbash centerpiece: many un-numbered parts, no split', async () => {
    await tree(
      'Khepresh - Presupported/Khepresh - Presupported/STL_Khepresh_body_supported.stl',
      'Khepresh - Presupported/Khepresh - Presupported/STL_Khepresh_head_supported.stl',
      'Khepresh - Presupported/Khepresh - Presupported/STL_Khepresh_arm_l_supported.stl',
      'Khepresh - Presupported/Khepresh - Presupported/STL_Khepresh_arm_r_supported.stl',
      'Khepresh - Presupported/Khepresh - Presupported/EoSVS.IndPres.Khepresh.jpg',
    )
    const r = await run()
    expect(names(r)).toEqual(['Khepresh'])
    expect(r.models[0].files).toHaveLength(4)
  })

  it('compilation archive with ONE wrapper: one model folder each (Empire of Sands shape)', async () => {
    const w = 'Archvillain Bestiary Vol. XXXVI - Presupported/Archvillain Bestiary Vol. XXXVI - Presupported'
    await tree(
      `${w}/Hoardlurk - Presupported/STL_Hoardlurk_supported.stl`,
      `${w}/Hoardlurk - Presupported/EoSVS.IndPres.AVB.Hoardlurk.jpg`,
      `${w}/Scarab Dragon - Presupported/STL_Dragon_body_supported.stl`,
      `${w}/Scarab Dragon - Presupported/STL_Dragon_wing_l_supported.stl`,
      `${w}/Scarab Dragon - Presupported/EoSVS.IndPres.AVB.ScarabDragon.jpg`,
    )
    const r = await run()
    expect(r.warnings).toEqual([])
    expect(names(r)).toEqual(['Hoardlurk', 'Scarab Dragon'])
    expect(r.models.every(m => m.userTags?.includes('bestiary'))).toBe(true)
  })

  it('compilation archive with a DOUBLED wrapper still finds every model (High Seas shape)', async () => {
    const w = 'Archvillain Society Vol. LXI - Presupported/Archvillain Society Vol. LXI - Presupported/Archvillain Society Vol. LXI - Presupported'
    await tree(
      `${w}/Bishka Weer - Wavewhispering Shaman - Presupported/STL_Weer_supported.stl`,
      `${w}/Bishka Weer - Wavewhispering Shaman - Presupported/HSTM.IndPres.AVS.BishkaWeer.jpg`,
      `${w}/Kaimoku - Reef Knight - Presupported/STL_Kaimoku_supported.stl`,
      `${w}/Kaimoku - Reef Knight - Presupported/HSTM.IndPres.AVS.Kaimoku.jpg`,
    )
    const r = await run()
    expect(r.warnings).toEqual([])
    expect(names(r)).toEqual(['Bishka Weer - Wavewhispering Shaman', 'Kaimoku - Reef Knight'])
    expect(r.models.every(m => m.userTags?.includes('society'))).toBe(true)
  })

  it('multi-pose model with a shared base: the base goes into every pose (Oceanvoid Scion shape)', async () => {
    await tree(
      'Oceanvoid Scion - Presupported/Oceanvoid Scion - Presupported/STL_Scion_body_01_supported.stl',
      'Oceanvoid Scion - Presupported/Oceanvoid Scion - Presupported/STL_Scion_body_02_supported.stl',
      'Oceanvoid Scion - Presupported/Oceanvoid Scion - Presupported/STL_Scion_base_scenic_supported.stl',
      'Oceanvoid Scion - Presupported/Oceanvoid Scion - Presupported/STL_Scion_base_standard_supported.stl',
      'Oceanvoid Scion - Presupported/Oceanvoid Scion - Presupported/HSTM.IndPres.AVB.OceanvoidScion.jpg',
    )
    const r = await run()
    expect(names(r)).toEqual(['Oceanvoid Scion 1', 'Oceanvoid Scion 2'])
    expect(filesOf(r, 'Oceanvoid Scion 1')).toEqual([
      'STL_Scion_base_scenic_supported.stl', 'STL_Scion_base_standard_supported.stl', 'STL_Scion_body_01_supported.stl',
    ])
    // the one group render is shared to both poses
    expect(r.models.every(m => m.imageFiles.length === 1)).toBe(true)
  })

  it('warns and skips a folder that has model files AND sub-folders with model files', async () => {
    await tree(
      'Weird - Presupported/Weird - Presupported/STL_Weird_supported.stl',
      'Weird - Presupported/Weird - Presupported/Bonus/STL_Bonus_supported.stl',
    )
    const r = await run()
    expect(r.models).toEqual([])
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings[0]).toMatch(/model files and also sub-folders/)
  })

  it('warns on a dead-end folder with nothing usable', async () => {
    await tree('Empty - Presupported/Empty - Presupported/readme.txt')
    const r = await run()
    expect(r.models).toEqual([])
    expect(r.warnings.join()).toMatch(/none contain model files/)
  })
})
