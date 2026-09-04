/**
 * One-off: rename raw Rescale "Warden of Lies" model/pose folders to
 * pipeline-style display names (folder rename only -- no file contents or
 * config.orynt3d touched).
 *
 *   node scripts/rename-warden-of-lies.mjs "<Warden of Lies folder>"        # dry run
 *   node scripts/rename-warden-of-lies.mjs "<Warden of Lies folder>" --go   # execute
 *
 * modelmeta.name is null throughout this pack, so Orynt displays the folder
 * name directly -- renaming the folder is the whole fix, nothing else to change.
 *
 * A folder is "raw" when it ends in "_Supports" (case-insensitive); anything
 * else is assumed already renamed and left alone (idempotent re-run). The
 * MoonElfSentinel poses carry a leading ordering prefix ("01_".."30_") that is
 * dropped -- the pose names themselves (RunSpear, StandGeneral, ...) are all
 * unique, so no collisions.
 *
 * "*_Base_Supports" folders (shared-base-as-its-own-model, same bug fixed in
 * the Rescale profile for future imports) are NOT renamed here -- they need
 * the copy-into-siblings-then-delete treatment instead, and are only reported.
 */
import { readdir, rename, stat } from 'node:fs/promises'
import { join } from 'node:path'

const root = process.argv[2]
const GO = process.argv.includes('--go')
if (!root) {
  console.error('usage: node scripts/rename-warden-of-lies.mjs "<Warden of Lies folder>" [--go]')
  process.exit(1)
}

const CATEGORIES = ['enemies', 'npcs']

function parseCaseName(name) {
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim()
}

/** Derive the clean display name from a raw folder name, or null if it isn't raw. */
function deriveName(folderName) {
  if (!/_Supports$/i.test(folderName)) return null
  let name = folderName.replace(/_Supports$/i, '')
  name = name.replace(/^\d+_/, '') // drop a leading ordering prefix ("13_")
  return name.split('_').map(parseCaseName).filter(Boolean).join(' ').trim()
}

async function entriesOf(dir) {
  return readdir(dir, { withFileTypes: true }).catch(() => [])
}

const TRANSIENT = new Set(['UNKNOWN', 'EBUSY', 'EPERM', 'EACCES', 'ECONNRESET', 'ETIMEDOUT', 'ENOTCONN', 'ENETDOWN', 'EHOSTUNREACH', 'EAI_AGAIN', 'EPIPE'])
async function retry(fn, label) {
  for (let a = 0; ; a++) {
    try { return await fn() }
    catch (err) {
      if (a >= 5 || !TRANSIENT.has(err?.code)) throw err
      const d = 1000 * 2 ** a
      console.error(`    retry ${a + 1}/5 in ${d / 1000}s -- ${label} (${err.code})`)
      await new Promise(r => setTimeout(r, d))
    }
  }
}

const plan = []      // { category, from, to }
const baseFolders = []  // { category, name } -- flagged, not renamed
const alreadyClean = []
const conflicts = []

for (const category of CATEGORIES) {
  const dir = join(root, category)
  for (const e of await entriesOf(dir)) {
    if (!e.isDirectory()) continue

    if (/_Base_Supports$/i.test(e.name)) {
      baseFolders.push({ category, name: e.name })
      continue
    }

    const newName = deriveName(e.name)
    if (!newName) { alreadyClean.push({ category, name: e.name }); continue }
    if (newName === e.name) { alreadyClean.push({ category, name: e.name }); continue }

    const dest = join(dir, newName)
    const destExists = await stat(dest).then(() => true).catch(() => false)
    if (destExists) { conflicts.push({ category, from: e.name, to: newName }); continue }

    plan.push({ category, from: e.name, to: newName })
  }
}

console.log(`\n${plan.length} to rename, ${alreadyClean.length} already clean, ${baseFolders.length} shared-base folder(s) flagged, ${conflicts.length} conflict(s).\n`)

for (const p of plan) console.log(`  ${p.category}/${p.from}  ->  ${p.to}`)

if (baseFolders.length) {
  console.log('\n--- shared-base folders (not renamed -- need copy-into-siblings + delete) ---')
  for (const b of baseFolders) console.log(`  ${b.category}/${b.name}`)
}

if (conflicts.length) {
  console.log('\n--- conflicts (destination already exists, skipped) ---')
  for (const c of conflicts) console.log(`  ${c.category}/${c.from}  ->  ${c.to}`)
}

if (!GO) {
  console.log('\n(dry run -- re-run with --go to execute)')
  process.exit(0)
}

console.log('\nExecuting...\n')
let renamed = 0, failed = 0
for (const p of plan) {
  const dir = join(root, p.category)
  try {
    await retry(() => rename(join(dir, p.from), join(dir, p.to)), `rename ${p.from}`)
    renamed++
    console.log(`  renamed: ${p.category}/${p.from} -> ${p.to}`)
  } catch (err) {
    failed++
    console.error(`  FAILED ${p.category}/${p.from}: ${err}`)
  }
}

console.log(`\nDone. ${renamed}/${plan.length} renamed, ${failed} failed.`)
