import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readdir } from 'node:fs/promises'
import inquirer from 'inquirer'
import { syncToNas, stagingSize } from './pipeline/nas-sync.js'
import { getProfile } from './profiles/index.js'
import { loadEnv } from './util/env.js'

const fmtGB = (bytes: number) => `${(bytes / 1e9).toFixed(1)} GB`

async function main(): Promise<void> {
  await loadEnv()

  const nasRoot = process.env.NAS_3D_FILES_PATH
  if (!nasRoot) {
    console.error('NAS_3D_FILES_PATH is not set. Create a .env file (see .env.example).')
    process.exit(1)
  }

  const stagingRoot = join(process.env.STAGING_PATH || tmpdir(), '.orynt-staging')

  let subs: string[]
  try {
    subs = (await readdir(stagingRoot, { withFileTypes: true }))
      .filter(e => e.isDirectory())
      .map(e => e.name)
  } catch {
    console.error(`No staging directory at ${stagingRoot}. Nothing to sync.`)
    process.exit(1)
  }

  if (subs.length === 0) {
    console.error(`Staging directory ${stagingRoot} is empty. Nothing to sync.`)
    process.exit(1)
  }

  let subName = subs[0]
  if (subs.length > 1) {
    const answer = await inquirer.prompt<{ sub: string }>([
      { type: 'list', name: 'sub', message: 'Which staged subscription to sync?', choices: subs },
    ])
    subName = answer.sub
  }

  const profile = getProfile(subName)
  if (!profile) {
    console.error(`No profile named "${subName}" — cannot map it to a NAS folder.`)
    process.exit(1)
  }

  const stagedSubRoot = join(stagingRoot, subName)
  const { files, bytes } = await stagingSize(stagedSubRoot)
  console.log(`\nResuming sync of "${subName}" — ${files} files, ${fmtGB(bytes)}\n`)

  const started = Date.now()
  const sync = await syncToNas(stagedSubRoot, nasRoot, profile)
  const mins = ((Date.now() - started) / 60000).toFixed(1)
  console.log(`\nDone. ${sync.method} synced (${sync.copied} copied, ${sync.skipped} up to date) in ${mins}m.`)
  console.log(`Staging kept at ${stagedSubRoot}. Delete it once you've confirmed the models in Orynt3D.`)
}

main().catch(err => {
  console.error('\nFatal error:', err)
  process.exit(1)
})
