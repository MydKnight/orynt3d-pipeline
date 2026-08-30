import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { rm, mkdir, stat } from 'node:fs/promises'
import { saveSession, loadSession, hasSession } from '../../src/pipeline/session.js'
import type { ClassifiedModel } from '../../src/profiles/types.js'

const SESSIONS_DIR = 'sessions'

function model(overrides: Partial<ClassifiedModel> = {}): ClassifiedModel {
  return {
    packName: 'Empire of Sands - Vault of the Scarab God',
    scale: '32mm',
    category: 'Models',
    modelName: 'Vaultsworn Zealot 1',
    supportType: 'ReadyToSlice',
    sourceFolder: '/tmp/x',
    files: [],
    ...overrides,
  }
}

beforeEach(async () => {
  await rm(SESSIONS_DIR, { recursive: true, force: true })
})

afterAll(async () => {
  await rm(SESSIONS_DIR, { recursive: true, force: true })
})

describe('saveSession', () => {
  it('creates the sessions directory if it does not exist', async () => {
    // regression: saveSession used to ENOENT on a fresh checkout
    const path = await saveSession('/downloads/Empire of Sands - Vault of the Scarab God', 'Archvillain Games', [model()])
    expect((await stat(path)).isFile()).toBe(true)
  })

  it('writes into an existing sessions directory too', async () => {
    await mkdir(SESSIONS_DIR, { recursive: true })
    const path = await saveSession('/downloads/Some Pack', 'Rescale', [model({ packName: 'Some Pack' })])
    expect((await stat(path)).isFile()).toBe(true)
  })

  it('strips .zip and .rar from the session filename', async () => {
    const zip = await saveSession('/d/Thing.zip', 'Loot Studios', [model()])
    const rar = await saveSession('/d/Thing.rar', 'Archvillain Games', [model()])
    expect(zip.endsWith('Thing.session.json')).toBe(true)
    expect(rar.endsWith('Thing.session.json')).toBe(true)
  })
})

describe('saveSession / loadSession roundtrip', () => {
  it('restores classificationTag and userTags onto matching models', async () => {
    const input = '/downloads/Empire of Sands - Vault of the Scarab God'
    await saveSession(input, 'Archvillain Games', [
      model({ modelName: 'Vaultsworn Zealot 1', classificationTag: 'monster', userTags: ['scarab', 'undead'] }),
      model({ modelName: 'Khepresh - The Vault Father', classificationTag: 'monster', userTags: ['boss'] }),
    ])

    const fresh = [
      model({ modelName: 'Vaultsworn Zealot 1' }),
      model({ modelName: 'Khepresh - The Vault Father' }),
    ]
    const loaded = await loadSession(input, fresh)

    expect(loaded).toBe(true)
    expect(fresh[0].classificationTag).toBe('monster')
    expect(fresh[0].userTags).toEqual(['scarab', 'undead'])
    expect(fresh[1].userTags).toEqual(['boss'])
  })

  it('leaves models that were not in the session untouched', async () => {
    const input = '/downloads/Pack'
    await saveSession(input, 'Rescale', [model({ modelName: 'A', classificationTag: 'hero' })])

    const fresh = [model({ modelName: 'B' })]
    await loadSession(input, fresh)

    expect(fresh[0].classificationTag).toBeUndefined()
  })

  it('loadSession returns false when no session file exists', async () => {
    expect(await loadSession('/downloads/Nope', [model()])).toBe(false)
    expect(await hasSession('/downloads/Nope')).toBe(false)
  })
})
