import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import inquirer from 'inquirer'
import { getProfileNames, getProfile } from './profiles/index.js'
import { extractZip } from './pipeline/extractor.js'
import { classify } from './pipeline/classifier.js'
import { applyFilter } from './pipeline/filter.js'
import { reviewConflicts } from './pipeline/reviewer.js'
import { tagModels } from './pipeline/tagger.js'
import { saveSession, loadSession, hasSession } from './pipeline/session.js'
import { reorganize } from './pipeline/reorganizer.js'

// ─── Load .env ────────────────────────────────────────────────────────────────

async function loadEnv(): Promise<void> {
  try {
    const raw = await readFile('.env', 'utf8')
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq === -1) continue
      const key = trimmed.slice(0, eq).trim()
      const value = trimmed.slice(eq + 1).trim()
      if (!process.env[key]) process.env[key] = value
    }
  } catch {
    // No .env file — rely on environment variables being set
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  await loadEnv()

  const nasRoot = process.env.NAS_3D_FILES_PATH
  if (!nasRoot) {
    console.error('NAS_3D_FILES_PATH is not set. Create a .env file (see .env.example).')
    process.exit(1)
  }

  console.log('\n=== orynt3d-pipeline ===\n')

  // 1. ZIP path
  const { zipPath } = await inquirer.prompt<{ zipPath: string }>([
    {
      type: 'input',
      name: 'zipPath',
      message: 'Path to ZIP file:',
      validate: (v: string) => v.trim().length > 0 || 'Required',
    },
  ])

  // 2. Subscription profile
  const profileNames = getProfileNames()
  const { profileName } = await inquirer.prompt<{ profileName: string }>([
    {
      type: 'list',
      name: 'profileName',
      message: 'Which subscription is this from?',
      choices: profileNames,
    },
  ])

  const profile = getProfile(profileName)!

  // 3. Extract
  const resolvedZipPath = resolve(zipPath.trim())
  console.log('\nExtracting ZIP...')
  const { extractedRoot, cleanup } = await extractZip(resolvedZipPath)

  try {
    // 4. Classify
    console.log('Classifying models...')
    const { models } = await classify(extractedRoot, profile)
    console.log(`  Found ${models.length} model variants`)

    // 5. Filter
    const { included, fdmConflicts, skipped } = applyFilter(models, profile)
    console.log(`  Included: ${included.length} | Conflicts: ${fdmConflicts.length} | Skipped: ${skipped.length}`)

    if (skipped.length > 0) {
      const types = [...new Set(skipped.map(m => m.supportType))].join(', ')
      console.log(`  (Skipped types: ${types})`)
    }

    // 6. Resolve FDM conflicts via TUI
    const { resolved } = await reviewConflicts(fdmConflicts)

    const finalModels = [...included, ...resolved]

    if (finalModels.length === 0) {
      console.log('\nNo models to import after filtering. Exiting.')
      return
    }

    // 7. Interactive tagging — load saved session or prompt
    let sessionLoaded = false

    if (await hasSession(resolvedZipPath)) {
      const { useSession } = await inquirer.prompt<{ useSession: boolean }>([
        {
          type: 'confirm',
          name: 'useSession',
          message: 'Saved tagging session found for this ZIP. Load it?',
          default: true,
        },
      ])
      if (useSession) {
        await loadSession(resolvedZipPath, finalModels)
        sessionLoaded = true
      }
    }

    if (!sessionLoaded) {
      console.log(`\nTag each model. Structural tags are applied automatically.`)
      console.log(`Press Enter to skip a model (structural tags only).\n`)
      await tagModels(finalModels, profile)
    }

    // Save session immediately after tagging — before confirm
    const savedPath = await saveSession(resolvedZipPath, profileName, finalModels)
    console.log(`Session saved to ${savedPath}`)

    // 8. Preview + confirm
    const packSummary = new Map<string, number>()
    for (const m of finalModels) {
      const key = `${m.packName} (${m.scale})`
      packSummary.set(key, (packSummary.get(key) ?? 0) + 1)
    }

    console.log(`\nReady to write ${finalModels.length} models to:\n  ${nasRoot}\\${profile.name}\\`)
    for (const [pack, count] of packSummary) {
      console.log(`    ${pack}: ${count} models`)
    }

    const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
      {
        type: 'confirm',
        name: 'confirm',
        message: 'Proceed?',
        default: false,
      },
    ])

    if (!confirm) {
      console.log('Cancelled.')
      return
    }

    // 8. Reorganize + write configs
    console.log('\nWriting to NAS...')
    const { written, errors } = await reorganize(finalModels, profile, nasRoot)

    console.log(`\nDone. ${written} models written.`)

    if (errors.length > 0) {
      console.log(`\n${errors.length} error(s):`)
      for (const { model, error } of errors) {
        console.log(`  ${model.modelName}: ${error}`)
      }
    }
  } finally {
    await cleanup()
  }
}

main().catch(err => {
  console.error('\nFatal error:', err)
  process.exit(1)
})
