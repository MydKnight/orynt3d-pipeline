/**
 * One-off: split multi-style Archvillain model folders that were imported before
 * the pipeline treated each style as its own model.
 *
 *   node scripts/explode-styles.mjs "<subscription folder>"          # dry run
 *   node scripts/explode-styles.mjs "<subscription folder>" --go     # execute
 *
 * A model folder is "multi-style" when its STL files carry two or more distinct
 * two-digit pose tokens AND the numbered STLs outnumber the un-numbered ones
 * (so a kitbash centerpiece with a couple of numbered part-options is left
 * alone). Each style N becomes a sibling folder "<base> <N>" holding that
 * style's STLs + its render. A few shared un-numbered files (e.g. one base
 * common to every pose) are COPIED into each style folder. Numbered files move
 * server-side (fs.rename within the share). The emptied parent is removed only
 * after all its moves land.
 */
import { readdir, mkdir, rename, rmdir, copyFile } from 'node:fs/promises'
import { join } from 'node:path'
import { poseNumber, isModelFile, isImageFile } from '../src/profiles/archvillain-games.ts'

const root = process.argv[2]
const GO = process.argv.includes('--go')
const excludeArg = process.argv.find(a => a.startsWith('--exclude='))
const EXCLUDE = new Set((excludeArg?.split('=')[1] ?? '').split(',').map(s => s.trim()).filter(Boolean))
if (!root) {
  console.error('usage: node scripts/explode-styles.mjs "<subscription folder>" [--go] [--exclude="Name A,Name B"]')
  process.exit(1)
}

const styleBase = (folderName) =>
  folderName
    .replace(/\s*\(\d+\s*styles?\)\s*$/i, '')
    .replace(/\s*-\s*presupported\s*$/i, '')
    .trim()

async function entriesOf(dir) {
  return readdir(dir, { withFileTypes: true }).catch(() => [])
}

/** Yield every leaf model folder under `base`, whatever the intermediate nesting
 *  (release/category/model, release/model, release/Models/model). A folder is a
 *  model folder when it directly contains model files, or wraps them one dir
 *  deep; otherwise recurse. */
async function* modelFolders(dir, trail = []) {
  const entries = await entriesOf(dir)
  const hasModelFiles = entries.some(e => e.isFile() && isModelFile(e.name))
  if (hasModelFiles) {
    yield { path: dir, trail, filesDir: dir }
    return
  }
  const subdirs = entries.filter(e => e.isDirectory())
  // one wrapper subdirectory that itself holds the files
  if (subdirs.length === 1) {
    const inner = join(dir, subdirs[0].name)
    if ((await entriesOf(inner)).some(e => e.isFile() && isModelFile(e.name))) {
      yield { path: dir, trail, filesDir: inner }
      return
    }
  }
  for (const sub of subdirs) {
    yield* modelFolders(join(dir, sub.name), [...trail, sub.name])
  }
}

const split = []
const kitbash = []
let singleStyle = 0

for await (const m of modelFolders(root)) {
  const entries = await entriesOf(m.filesDir)
  const stls = entries.filter(e => e.isFile() && isModelFile(e.name)).map(e => e.name)
  const images = entries.filter(e => e.isFile() && isImageFile(e.name)).map(e => e.name)

  const numbered = stls.filter(s => poseNumber(s) !== null)
  const unNumberedStls = stls.filter(s => poseNumber(s) === null)
  const poses = [...new Set(numbered.map(poseNumber))].sort()

  if (poses.length < 2) { singleStyle++; continue }
  if (unNumberedStls.length >= numbered.length) {
    kitbash.push({ ...m, name: m.trail.at(-1), stls: stls.length, numbered: numbered.length })
    continue
  }

  const name = m.trail.at(-1)
  const base = styleBase(name)
  if (EXCLUDE.has(base) || EXCLUDE.has(name)) { singleStyle++; continue }

  // an image counts as "this style's" only if its pose token matches a real pose
  const styleImg = (f) => poses.includes(poseNumber(f))
  const matchedImgs = images.filter(styleImg)
  const otherFiles = [
    ...unNumberedStls,
    ...images.filter(i => !matchedImgs.includes(i)),
    ...entries.filter(e => e.isFile() && e.name === 'config.orynt3d').map(e => e.name),
  ]
  const byStyle = poses.map(n => ({
    n,
    target: `${base} ${parseInt(n, 10)}`,
    move: [...numbered, ...matchedImgs].filter(f => poseNumber(f) === n),
  }))
  split.push({ ...m, name, base, byStyle, sharedCopy: otherFiles })
}

console.log(`\n${split.length} to split, ${kitbash.length} kitbash left alone, ${singleStyle} single-style skipped.\n`)

for (const p of split) {
  console.log(`${p.trail.join(' / ')}`)
  for (const s of p.byStyle) console.log(`   -> ${s.target}/   (${s.move.length} moved${p.sharedCopy.length ? ` + ${p.sharedCopy.length} shared copied` : ''})`)
  if (p.sharedCopy.length) console.log(`   shared into every style: ${p.sharedCopy.join(', ')}`)
}

if (kitbash.length) {
  console.log('\n--- kitbash / part-options, left as one model ---')
  for (const k of kitbash) console.log(`   ${k.trail.join(' / ')}  (${k.numbered}/${k.stls} STLs numbered)`)
}

console.log('\n--- detected split model names ---')
console.log([...new Set(split.map(p => p.base))].sort().join('\n'))

if (!GO) {
  console.log('\n(dry run — re-run with --go to execute)')
  process.exit(0)
}

console.log('\nExecuting...\n')
const { rm } = await import('node:fs/promises')
const TRANSIENT = new Set(['UNKNOWN', 'EBUSY', 'EPERM', 'EACCES', 'ECONNRESET', 'ETIMEDOUT', 'ENOTCONN', 'ENETDOWN', 'EHOSTUNREACH', 'EAI_AGAIN', 'EPIPE'])
async function retry(fn, label) {
  for (let a = 0; ; a++) {
    try { return await fn() }
    catch (err) {
      if (a >= 5 || !TRANSIENT.has(err?.code)) throw err
      const d = 1000 * 2 ** a
      console.error(`    retry ${a + 1}/5 in ${d / 1000}s — ${label} (${err.code})`)
      await new Promise(r => setTimeout(r, d))
    }
  }
}

let moved = 0, copied = 0, removed = 0, failedFolders = 0
for (const p of split) {
  const targetParent = join(p.path, '..')
  try {
    let ok = true
    for (const s of p.byStyle) {
      const targetDir = join(targetParent, s.target)
      await retry(() => mkdir(targetDir, { recursive: true }), `mkdir ${s.target}`)
      for (const f of s.move) {
        try { await retry(() => rename(join(p.filesDir, f), join(targetDir, f)), `mv ${f}`); moved++ }
        catch (err) { console.error(`  MOVE FAILED ${f}: ${err}`); ok = false }
      }
      for (const f of p.sharedCopy) {
        // idempotent: skip if already copied on a prior run
        try {
          await retry(async () => {
            try { await rename(join(targetDir, f), join(targetDir, f)) } catch {}
            await copyFile(join(p.filesDir, f), join(targetDir, f))
          }, `cp ${f}`)
          copied++
        } catch (err) { console.error(`  COPY FAILED ${f}: ${err}`); ok = false }
      }
    }
    const leftover = await readdir(p.filesDir).catch(() => ['?'])
    const onlyShared = leftover.every(f => p.sharedCopy.includes(f))
    if (ok && onlyShared) {
      for (const f of leftover) await retry(() => rm(join(p.filesDir, f), { force: true }), `rm ${f}`)
      if (p.filesDir !== p.path) await rmdir(p.filesDir).catch(() => {})
      await rmdir(p.path).catch(() => {})
      removed++
      console.log(`  split + removed: ${p.name}`)
    } else {
      console.log(`  split, KEPT ${p.name} — remains: ${leftover.join(', ')}`)
    }
  } catch (err) {
    failedFolders++
    console.error(`  !! ${p.name} failed: ${err}`)
  }
}

// tidy any parent folders that were fully emptied by a prior interrupted run
async function tidyEmpties(dir, depth = 0) {
  if (depth > 4) return
  for (const e of await entriesOf(dir)) {
    if (!e.isDirectory()) continue
    const sub = join(dir, e.name)
    await tidyEmpties(sub, depth + 1)
    if (/\(\d+\s*styles?\)|-\s*presupported\s*$/i.test(e.name)) {
      const inner = await entriesOf(sub)
      if (inner.length === 0) { await rmdir(sub).catch(() => {}); console.log(`  tidied empty: ${e.name}`) }
    }
  }
}
await tidyEmpties(root)

console.log(`\nDone. ${moved} moved, ${copied} shared copies, ${removed}/${split.length} parents removed, ${failedFolders} folder(s) failed.`)
