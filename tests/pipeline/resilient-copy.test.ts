import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, writeFile, readFile, readdir, stat, rm, copyFile as realCopyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isTransient, resilientCopy } from '../../src/pipeline/resilient-copy.js'

let dir: string
const noSleep = async () => {}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'rc-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function src(name: string, content: string): Promise<string> {
  const p = join(dir, name)
  await writeFile(p, content)
  return p
}

describe('isTransient', () => {
  it('flags share/network hiccup codes', () => {
    expect(isTransient(Object.assign(new Error(), { code: 'UNKNOWN' }))).toBe(true)
    expect(isTransient(Object.assign(new Error(), { code: 'ETIMEDOUT' }))).toBe(true)
    expect(isTransient(Object.assign(new Error(), { code: 'EPERM' }))).toBe(true)
  })
  it('does not flag real errors', () => {
    expect(isTransient(Object.assign(new Error(), { code: 'ENOENT' }))).toBe(false)
    expect(isTransient(new Error('plain'))).toBe(false)
    expect(isTransient(undefined)).toBe(false)
  })
})

describe('resilientCopy', () => {
  it('copies a new file and reports it was not skipped', async () => {
    const s = await src('a.txt', 'hello')
    const d = join(dir, 'out', 'a.txt')
    const res = await resilientCopy(s, d, { sleep: noSleep })
    expect(res.skipped).toBe(false)
    expect(await readFile(d, 'utf8')).toBe('hello')
  })

  it('skips when the destination already matches by size', async () => {
    const s = await src('a.txt', 'same-size')
    const d = join(dir, 'a-copy.txt')
    await writeFile(d, 'same-size') // identical length
    const res = await resilientCopy(s, d, { sleep: noSleep })
    expect(res.skipped).toBe(true)
  })

  it('recopies a truncated destination (size mismatch)', async () => {
    const s = await src('a.txt', 'the full content')
    const d = join(dir, 'a-copy.txt')
    await writeFile(d, 'the full') // shorter — simulates a drop mid-copy
    const res = await resilientCopy(s, d, { sleep: noSleep })
    expect(res.skipped).toBe(false)
    expect(await readFile(d, 'utf8')).toBe('the full content')
  })

  it('leaves no ~*.tmp behind on success', async () => {
    const s = await src('a.txt', 'x')
    await resilientCopy(s, join(dir, 'out', 'a.txt'), { sleep: noSleep })
    const leftovers = (await readdir(join(dir, 'out'))).filter(n => n.includes('.tmp'))
    expect(leftovers).toEqual([])
  })

  it('retries a transient failure then succeeds', async () => {
    const s = await src('a.txt', 'payload')
    const d = join(dir, 'out', 'a.txt')
    let calls = 0
    const copyFile = vi.fn(async (from: string, to: string) => {
      if (++calls <= 2) throw Object.assign(new Error('blip'), { code: 'UNKNOWN' })
      await realCopyFile(from, to)
    })
    const onRetry = vi.fn()
    const res = await resilientCopy(s, d, { sleep: noSleep, copyFile, onRetry })
    expect(res.skipped).toBe(false)
    expect(calls).toBe(3)
    expect(onRetry).toHaveBeenCalledTimes(2)
    expect(await readFile(d, 'utf8')).toBe('payload')
  })

  it('gives up after the retry budget and never leaves a partial dest', async () => {
    const s = await src('a.txt', 'payload')
    const d = join(dir, 'out', 'a.txt')
    const copyFile = vi.fn(async () => { throw Object.assign(new Error('down'), { code: 'ENETDOWN' }) })
    await expect(resilientCopy(s, d, { sleep: noSleep, retries: 3, copyFile })).rejects.toThrow('down')
    expect(copyFile).toHaveBeenCalledTimes(4) // 1 + 3 retries
    await expect(stat(d)).rejects.toThrow() // dest never created
    const leftovers = (await readdir(join(dir, 'out')).catch(() => [])).filter(n => n.includes('.tmp'))
    expect(leftovers).toEqual([])
  })

  it('does not retry a non-transient error', async () => {
    const s = await src('a.txt', 'payload')
    const copyFile = vi.fn(async () => { throw Object.assign(new Error('nope'), { code: 'ENOENT' }) })
    const onRetry = vi.fn()
    await expect(resilientCopy(s, join(dir, 'out', 'a.txt'), { sleep: noSleep, copyFile, onRetry })).rejects.toThrow('nope')
    expect(copyFile).toHaveBeenCalledTimes(1)
    expect(onRetry).not.toHaveBeenCalled()
  })
})
