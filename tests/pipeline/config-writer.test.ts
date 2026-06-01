import { describe, it, expect, beforeEach } from 'vitest'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  writeSubscriptionConfig,
  writePackConfig,
  writeModelConfig,
} from '../../src/pipeline/config-writer.js'
import type { ClassifiedModel } from '../../src/profiles/types.js'

function makeModel(overrides: Partial<ClassifiedModel> = {}): ClassifiedModel {
  return {
    packName: 'The Cursed Marshes',
    scale: '32mm',
    category: 'Enemy',
    modelName: 'Bonegrinder Titan',
    supportType: 'ReadyToSlice',
    classificationTag: 'monster',
    sourceFolder: '/tmp/test',
    files: ['model.stl'],
    userTags: ['cr10', 'construct', 'huge'],
    ...overrides,
  }
}

async function readConfig(folder: string): Promise<Record<string, unknown>> {
  const raw = await readFile(join(folder, 'config.orynt3d'), 'utf8')
  return JSON.parse(raw)
}

let tempDir: string

beforeEach(async () => {
  tempDir = join(tmpdir(), `config-writer-test-${Date.now()}`)
  await mkdir(tempDir, { recursive: true })
})

describe('writeSubscriptionConfig', () => {
  it('writes version 5 config with subscription attribute', async () => {
    await writeSubscriptionConfig(tempDir, 'Flesh of Gods')
    const cfg = await readConfig(tempDir)
    expect(cfg.version).toBe(5)
    const attrs = (cfg as any).scancfg.attributes.include
    expect(attrs).toContainEqual({ key: 'subscription', value: 'fleshofgods' })
  })

  it('strips spaces from subscription name', async () => {
    await writeSubscriptionConfig(tempDir, 'Loot Studios')
    const cfg = await readConfig(tempDir)
    const attrs = (cfg as any).scancfg.attributes.include
    expect(attrs).toContainEqual({ key: 'subscription', value: 'lootstudios' })
  })

  it('does not overwrite an existing config', async () => {
    await writeSubscriptionConfig(tempDir, 'Flesh of Gods')
    await writeSubscriptionConfig(tempDir, 'Different Name')
    const cfg = await readConfig(tempDir)
    const attrs = (cfg as any).scancfg.attributes.include
    expect(attrs).toContainEqual({ key: 'subscription', value: 'fleshofgods' })
  })
})

describe('writePackConfig', () => {
  it('writes release and scale attributes', async () => {
    await writePackConfig(tempDir, 'The Cursed Marshes', '32mm')
    const cfg = await readConfig(tempDir)
    const attrs = (cfg as any).scancfg.attributes.include
    expect(attrs).toContainEqual({ key: 'release', value: 'the cursed marshes' })
    expect(attrs).toContainEqual({ key: 'scale', value: '32mm' })
  })

  it('does not overwrite an existing config', async () => {
    await writePackConfig(tempDir, 'The Cursed Marshes', '32mm')
    await writePackConfig(tempDir, 'Different Pack', '75mm')
    const cfg = await readConfig(tempDir)
    const attrs = (cfg as any).scancfg.attributes.include
    expect(attrs).toContainEqual({ key: 'release', value: 'the cursed marshes' })
  })
})

describe('writeModelConfig', () => {
  it('writes model name to modelmeta', async () => {
    await writeModelConfig(tempDir, makeModel())
    const cfg = await readConfig(tempDir)
    expect((cfg as any).modelmeta.name).toBe('Bonegrinder Titan')
  })

  it('includes classification, scale, print type, support, and user tags', async () => {
    await writeModelConfig(tempDir, makeModel())
    const cfg = await readConfig(tempDir)
    const tags = (cfg as any).scancfg.tags.include
    expect(tags).toContain('monster')
    expect(tags).toContain('32mm')
    expect(tags).toContain('resin')
    expect(tags).toContain('pre-supported')
    expect(tags).toContain('cr10')
    expect(tags).toContain('construct')
    expect(tags).toContain('huge')
  })

  it('tags FDM model with fdm print type', async () => {
    await writeModelConfig(tempDir, makeModel({ supportType: 'FDM', userTags: undefined }))
    const cfg = await readConfig(tempDir)
    const tags = (cfg as any).scancfg.tags.include
    expect(tags).toContain('fdm')
    expect(tags).not.toContain('resin')
  })

  it('always overwrites an existing model config', async () => {
    await writeModelConfig(tempDir, makeModel({ modelName: 'First Name' }))
    await writeModelConfig(tempDir, makeModel({ modelName: 'Updated Name' }))
    const cfg = await readConfig(tempDir)
    expect((cfg as any).modelmeta.name).toBe('Updated Name')
  })

  it('omits classification tag when not set', async () => {
    await writeModelConfig(tempDir, makeModel({ classificationTag: undefined }))
    const cfg = await readConfig(tempDir)
    const tags = (cfg as any).scancfg.tags.include
    expect(tags).not.toContain(undefined)
    expect(tags).toContain('32mm')
  })
})
