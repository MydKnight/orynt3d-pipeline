import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, readdir, stat, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { reorganize } from '../../src/pipeline/reorganizer.js'
import type { ClassifiedModel, SubscriptionProfile } from '../../src/profiles/types.js'

let root: string
let srcDir: string
let stagingRoot: string

const profile: SubscriptionProfile = {
  name: 'Test Sub',
  categoryMappings: { Models: { options: ['monster'] } },
  includesImages: true,
  classify: async () => [],
  filter: { include: ['ReadyToSlice'], includeFDM: false },
  formatPackFolder: (pack: string) => pack,
  formatModelFolder: (name: string) => name,
}

async function srcFile(name: string, content: string): Promise<string> {
  const p = join(srcDir, name)
  await writeFile(p, content)
  return p
}

function model(over: Partial<ClassifiedModel> = {}): ClassifiedModel {
  return {
    packName: 'Empire of Sands',
    scale: '32mm',
    category: 'Models',
    modelName: 'Khepresh',
    supportType: 'ReadyToSlice',
    sourceFolder: srcDir,
    files: [],
    imageFiles: [],
    ...over,
  }
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'reorg-'))
  srcDir = join(root, 'src'); await mkdir(srcDir)
  stagingRoot = join(root, 'staging')
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

describe('reorganize (local staging)', () => {
  it('builds subscription/pack/category/model tree with files, images and model config', async () => {
    const stl = await srcFile('body.stl', 'STL DATA')
    const img = await srcFile('render.jpg', 'JPG DATA')
    const res = await reorganize([model({ files: [stl], imageFiles: [img] })], profile, stagingRoot)

    const modelFolder = join(stagingRoot, 'Test Sub', 'Empire of Sands', 'Models', 'Khepresh')
    expect(res.staged).toBe(1)
    expect(res.incomplete).toEqual([])
    expect(await readFile(join(modelFolder, 'body.stl'), 'utf8')).toBe('STL DATA')
    expect(await readFile(join(modelFolder, 'render.jpg'), 'utf8')).toBe('JPG DATA')
    const cfg = JSON.parse(await readFile(join(modelFolder, 'config.orynt3d'), 'utf8'))
    expect(cfg.modelmeta.name).toBe('Khepresh')
  })

  it('does NOT write subscription or pack config (those go straight to the NAS)', async () => {
    const stl = await srcFile('body.stl', 'x')
    await reorganize([model({ files: [stl] })], profile, stagingRoot)
    const subFolder = join(stagingRoot, 'Test Sub')
    const packFolder = join(subFolder, 'Empire of Sands')
    await expect(stat(join(subFolder, 'config.orynt3d'))).rejects.toThrow()
    await expect(stat(join(packFolder, 'config.orynt3d'))).rejects.toThrow()
  })

  it('re-running skips files already staged at the same size', async () => {
    const stl = await srcFile('body.stl', 'STL DATA')
    const m = model({ files: [stl] })
    await reorganize([m], profile, stagingRoot)
    const dest = join(stagingRoot, 'Test Sub', 'Empire of Sands', 'Models', 'Khepresh', 'body.stl')
    const mtime1 = (await stat(dest)).mtimeMs
    await new Promise(r => setTimeout(r, 10))
    await reorganize([m], profile, stagingRoot)
    expect((await stat(dest)).mtimeMs).toBe(mtime1) // untouched
  })

  it('leaves no ~*.tmp files in the staged tree', async () => {
    const stl = await srcFile('body.stl', 'x')
    await reorganize([model({ files: [stl] })], profile, stagingRoot)
    const modelFolder = join(stagingRoot, 'Test Sub', 'Empire of Sands', 'Models', 'Khepresh')
    expect((await readdir(modelFolder)).filter(n => n.includes('~') && n.endsWith('.tmp'))).toEqual([])
  })

  it('one model failing to stage does not abort the rest of the run', async () => {
    const stl = await srcFile('body.stl', 'ok')
    // a profile whose folder formatter throws for the first model only
    let n = 0
    const flaky: SubscriptionProfile = {
      ...profile,
      formatModelFolder: () => { if (n++ === 0) throw new Error('bad name'); return 'Good' },
    }
    const res = await reorganize(
      [model({ modelName: 'Bad', files: [stl] }), model({ modelName: 'Good', files: [stl] })],
      flaky,
      stagingRoot,
    )
    expect(res.staged).toBe(1)
    expect(res.incomplete.map(i => i.model)).toEqual(['Bad'])
    expect(await readFile(join(stagingRoot, 'Test Sub', 'Empire of Sands', 'Models', 'Good', 'body.stl'), 'utf8')).toBe('ok')
  })

  it('reports an incomplete model and withholds its config when a source file is missing', async () => {
    const good = await srcFile('body.stl', 'ok')
    const missing = join(srcDir, 'gone.stl') // never created
    const res = await reorganize([model({ files: [good, missing] })], profile, stagingRoot)
    expect(res.staged).toBe(0)
    expect(res.incomplete).toHaveLength(1)
    expect(res.incomplete[0].model).toBe('Khepresh')
    const modelFolder = join(stagingRoot, 'Test Sub', 'Empire of Sands', 'Models', 'Khepresh')
    expect(await readFile(join(modelFolder, 'body.stl'), 'utf8')).toBe('ok') // the good file still landed
    await expect(stat(join(modelFolder, 'config.orynt3d'))).rejects.toThrow() // config withheld
  })
})
