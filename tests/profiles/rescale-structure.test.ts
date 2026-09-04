import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { rescaleProfile as profile } from '../../src/profiles/rescale.js'
import type { ClassifiedModel } from '../../src/profiles/types.js'

let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'rescale-')) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

async function tree(...paths: string[]) {
  for (const p of paths) {
    const abs = join(root, p)
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, '')
  }
}

const run = () => profile.classify(root, join('/downloads', 'Pit of Pestilence Vol 2')) as Promise<ClassifiedModel[]>
const names = (models: ClassifiedModel[]) => models.map(m => m.modelName).sort()
const model = (models: ClassifiedModel[], n: string) => models.find(m => m.modelName === n)!
const fileNames = (models: ClassifiedModel[], n: string) => model(models, n).files.map(f => f.split(/[\\/]/).at(-1)).sort()

describe('rescale classify -- structure', () => {
  it('a pack Base folder is not its own model -- its files are merged into every real pose', async () => {
    const wrapper = 'PestilentBrute/PestilentBrute'
    await tree(
      `${wrapper}/PestilentBrute_Base_Supports/Supported/Base.stl`,
      `${wrapper}/PestilentBrute_Stand_Supports/Supported/Stand.stl`,
      `${wrapper}/PestilentBrute_Attack_Supports/Supported/Attack.stl`,
    )
    const models = await run()
    expect(names(models)).toEqual(['Pestilent Brute Attack', 'Pestilent Brute Stand'])
    expect(fileNames(models, 'Pestilent Brute Stand')).toEqual(['Base.stl', 'Stand.stl'])
    expect(fileNames(models, 'Pestilent Brute Attack')).toEqual(['Attack.stl', 'Base.stl'])
  })

  it('a pose that already ships its own base is not given the shared base too', async () => {
    const wrapper = 'KnightOfValor/KnightOfValor'
    await tree(
      `${wrapper}/KnightOfValor_Base_Supports/Supported/KnightOfValor_Base_Sup.stl`,
      `${wrapper}/KnightOfValor_AttackHammer_Supports/Supported/KnightOfValor_AttackHammer_Full_Sup.stl`,
      `${wrapper}/KnightOfValor_StandSword_Supports/Supported/KnightOfValor_StandSword_Base_Sup.stl`,
      `${wrapper}/KnightOfValor_StandSword_Supports/Supported/KnightOfValor_StandSword_Full_Sup.stl`,
    )
    const models = await run()
    expect(names(models)).toEqual(['Knight Of Valor Attack Hammer', 'Knight Of Valor Stand Sword'])
    // no own base -> gets the shared one
    expect(fileNames(models, 'Knight Of Valor Attack Hammer')).toEqual([
      'KnightOfValor_AttackHammer_Full_Sup.stl', 'KnightOfValor_Base_Sup.stl',
    ])
    // already has its own base -> shared base NOT added
    expect(fileNames(models, 'Knight Of Valor Stand Sword')).toEqual([
      'KnightOfValor_StandSword_Base_Sup.stl', 'KnightOfValor_StandSword_Full_Sup.stl',
    ])
  })

  it('a pack with no Base folder is unaffected', async () => {
    const wrapper = 'BlizzardTroll/BlizzardTroll'
    await tree(
      `${wrapper}/BlizzardTroll_Stand_Supports/Supported/Stand.stl`,
      `${wrapper}/BlizzardTroll_Wait_Supports/Supported/Wait.stl`,
    )
    const models = await run()
    expect(names(models)).toEqual(['Blizzard Troll Stand', 'Blizzard Troll Wait'])
    expect(fileNames(models, 'Blizzard Troll Stand')).toEqual(['Stand.stl'])
  })
})
