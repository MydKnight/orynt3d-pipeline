import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { syncToNas } from '../../src/pipeline/nas-sync.js'
import type { SubscriptionProfile } from '../../src/profiles/types.js'

const profile = { name: 'Test Sub' } as SubscriptionProfile

let root: string
let staged: string   // <staging>/<profile.name>
let nasRoot: string
let nasDest: string   // <nasRoot>/<profile.name>

async function put(base: string, rel: string, content: string) {
  const p = join(base, rel)
  await mkdir(join(p, '..'), { recursive: true })
  await writeFile(p, content)
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'sync-'))
  staged = join(root, 'staging', profile.name)
  nasRoot = join(root, 'nas')
  nasDest = join(nasRoot, profile.name)
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

describe('syncToNas — acceptance #1 shape (partial destination)', () => {
  it('fills only the gaps: skips unchanged files, recopies truncated, creates missing', async () => {
    // staged: the complete, correct tree
    await put(staged, 'Pack/Models/Complete/a.stl', 'AAA-full')
    await put(staged, 'Pack/Models/Complete/b.stl', 'BBB-full')
    await put(staged, 'Pack/Models/Partial/c.stl', 'CCC-full')
    await put(staged, 'Pack/Models/Partial/d.stl', 'DDD-full')
    await put(staged, 'Pack/Models/Missing/e.stl', 'EEE-full')

    // first sync lands everything on the "NAS"
    const first = await syncToNas(staged, nasRoot, profile, { onOutput: () => {} })
    expect(first.copied).toBe(5)

    // now degrade the NAS to mimic a mid-transfer drop: one model gone entirely,
    // one file truncated
    await rm(join(nasDest, 'Pack/Models/Missing'), { recursive: true })
    await writeFile(join(nasDest, 'Pack/Models/Partial/c.stl'), 'CCC') // truncated

    const res = await syncToNas(staged, nasRoot, profile, { onOutput: () => {} })

    // final NAS state == staged, no hand-deletion needed
    expect(await readFile(join(nasDest, 'Pack/Models/Complete/a.stl'), 'utf8')).toBe('AAA-full')
    expect(await readFile(join(nasDest, 'Pack/Models/Partial/c.stl'), 'utf8')).toBe('CCC-full')
    expect(await readFile(join(nasDest, 'Pack/Models/Missing/e.stl'), 'utf8')).toBe('EEE-full')

    // only the gap (truncated c + missing e) moved; the other 3 were left alone
    expect(res.copied).toBe(2)
    expect(res.skipped).toBe(3)
  })

  it('excludes ~*.tmp leftovers from the transfer', async () => {
    await put(staged, 'Pack/Models/M/good.stl', 'good')
    await put(staged, 'Pack/Models/M/good.stl~abc123.tmp', 'partial junk')
    await syncToNas(staged, nasRoot, profile, { onOutput: () => {} })
    expect(await readFile(join(nasDest, 'Pack/Models/M/good.stl'), 'utf8')).toBe('good')
    await expect(stat(join(nasDest, 'Pack/Models/M/good.stl~abc123.tmp'))).rejects.toThrow()
  })

  it('is idempotent — a second run copies nothing', async () => {
    await put(staged, 'Pack/Models/M/a.stl', 'aaa')
    await put(staged, 'Pack/Models/M/b.stl', 'bbbb')
    await syncToNas(staged, nasRoot, profile, { onOutput: () => {} })
    const res2 = await syncToNas(staged, nasRoot, profile, { onOutput: () => {} })
    expect(res2.copied).toBe(0)
  })
})
