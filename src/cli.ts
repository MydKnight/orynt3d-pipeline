import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { rm } from 'node:fs/promises'
import inquirer from 'inquirer'
import { getProfileNames, getProfile } from './profiles/index.js'
import { extractArchive } from './pipeline/extractor.js'
import { classify } from './pipeline/classifier.js'
import { applyFilter } from './pipeline/filter.js'
import { reviewConflicts } from './pipeline/reviewer.js'
import { tagModels } from './pipeline/tagger.js'
import { saveSession, loadSession, hasSession } from './pipeline/session.js'
import { reorganize } from './pipeline/reorganizer.js'
import { writeNasConfigs, syncToNas, stagingSize } from './pipeline/nas-sync.js'
import { upsertRelease, markProcessed, getAllReleases, isPackProcessed } from './db/releases.js'
import { loadEnv } from './util/env.js'

const fmtGB = (bytes: number) => `${(bytes / 1e9).toFixed(1)} GB`

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  await loadEnv()

  const nasRoot = process.env.NAS_3D_FILES_PATH
  if (!nasRoot) {
    console.error('NAS_3D_FILES_PATH is not set. Create a .env file (see .env.example).')
    process.exit(1)
  }

  console.log('\n=== orynt3d-pipeline ===\n')

  // 1. Archive path
  const { zipPath } = await inquirer.prompt<{ zipPath: string }>([
    {
      type: 'input',
      name: 'zipPath',
      message: 'Path to archive (ZIP/RAR) or folder:',
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
  console.log('\nExtracting...')
  const { extractedRoot, originalInputPath, cleanup } = await extractArchive(resolvedZipPath)

  try {
    // 4. Classify
    console.log('Classifying models...')
    const { models, warnings } = await classify(extractedRoot, profile, originalInputPath)

    if (warnings.length > 0) {
      console.log(`\n${warnings.length} folder(s) were NOT turned into models — the structure was ambiguous:`)
      for (const w of warnings) console.log(`  - ${w}`)
      const { proceed } = await inquirer.prompt<{ proceed: boolean }>([
        { type: 'confirm', name: 'proceed', message: 'Continue with the models that were classified?', default: false },
      ])
      if (!proceed) { console.log('Cancelled — fix the folder(s) and re-run.'); return }
    }

    const subscriptionKey = profile.name.toLowerCase().replace(/\s+/g, '')

    // Pre-flight: warn if pack appears already processed
    const firstPackName = models[0]?.packName
    if (firstPackName) {
      if (isPackProcessed(subscriptionKey, firstPackName)) {
        const { proceed } = await inquirer.prompt<{ proceed: boolean }>([
          {
            type: 'confirm',
            name: 'proceed',
            message: `"${firstPackName}" appears already imported. Import again?`,
            default: false,
          },
        ])
        if (!proceed) { console.log('Cancelled.'); return }
      }
    }
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

    // 8a. Stage the organised tree locally
    const stagingRoot = join(process.env.STAGING_PATH || tmpdir(), '.orynt-staging')
    console.log('\nStaging locally...')
    const { staged, incomplete, stagingRoot: stagedSubRoot } = await reorganize(finalModels, profile, stagingRoot)

    if (incomplete.length > 0) {
      console.log(`\n${incomplete.length} model(s) could not be staged completely:`)
      for (const { model, failed } of incomplete) {
        console.log(`  ${model}: ${failed.join('; ')}`)
      }
    }

    // 8b. Subscription / pack configs go straight to the NAS (write-once)
    console.log('\nWriting subscription + pack configs to NAS...')
    await writeNasConfigs(finalModels, profile, nasRoot)

    // 8c. Sync the staged tree to the NAS (robocopy restartable, or resilient fallback)
    const { files, bytes } = await stagingSize(stagedSubRoot)
    console.log(`\nSyncing to NAS — ${files} files, ${fmtGB(bytes)}...`)
    const started = Date.now()
    let sync
    try {
      sync = await syncToNas(stagedSubRoot, nasRoot, profile)
    } catch (err) {
      console.error(`\nSync failed: ${err}`)
      console.error(`Staging kept at ${stagedSubRoot} — reconnect and run \`npm run sync\` to resume.`)
      return
    }
    const mins = ((Date.now() - started) / 60000).toFixed(1)
    console.log(`\nDone. ${staged}/${finalModels.length} models staged; ${sync.method} synced (${sync.copied} copied, ${sync.skipped} up to date) in ${mins}m.`)

    // 8d. Offer to clear the local staging copy once everything is through
    if (incomplete.length === 0) {
      const { clean } = await inquirer.prompt<{ clean: boolean }>([
        { type: 'confirm', name: 'clean', message: `Remove local staging copy at ${stagedSubRoot}?`, default: false },
      ])
      if (clean) await rm(stagedSubRoot, { recursive: true, force: true })
    } else {
      console.log(`\nStaging kept at ${stagedSubRoot} (incomplete models). Re-run or \`npm run sync\` after fixing.`)
    }

    // 9. Mark release as processed in tracking DB
    if (staged > 0) {
      const packName = finalModels[0]?.packName ?? ''

      // Find unprocessed releases for this subscription — try to match by pack name
      const known = getAllReleases(subscriptionKey).filter(r => !r.processed_at)
      const match = known.find(r =>
        r.release_name.toLowerCase().includes(packName.toLowerCase()) ||
        packName.toLowerCase().includes(r.release_name.toLowerCase())
      )

      const choices = known.map(r => ({
        name: `${r.release_month ?? '????-??'} — ${r.release_name}`,
        value: r.release_name,
      }))

      if (choices.length > 0) {
        const { releaseName } = await inquirer.prompt<{ releaseName: string }>([
          {
            type: 'list',
            name: 'releaseName',
            message: 'Mark which release as processed in the tracker?',
            choices: [
              ...choices,
              { name: '(skip — don\'t update tracker)', value: '' },
            ],
            default: match?.release_name ?? '',
          },
        ])
        if (releaseName) {
          upsertRelease({ subscription: subscriptionKey, release_name: releaseName, owned: true })
          markProcessed(subscriptionKey, releaseName, packName)
          console.log(`Marked "${releaseName}" as processed.`)
        }
      } else {
        // No known releases — create a new entry with month
        const { track } = await inquirer.prompt<{ track: boolean }>([
          {
            type: 'confirm',
            name: 'track',
            message: `Add "${packName}" to the release tracker?`,
            default: true,
          },
        ])
        if (track) {
          const { releaseMonth } = await inquirer.prompt<{ releaseMonth: string }>([
            {
              type: 'input',
              name: 'releaseMonth',
              message: 'Release month (YYYY-MM):',
              default: new Date().toISOString().slice(0, 7),
              validate: v => /^\d{4}-\d{2}$/.test(v.trim()) || 'Format must be YYYY-MM',
            },
          ])
          upsertRelease({ subscription: subscriptionKey, release_name: packName, release_month: releaseMonth.trim(), owned: true })
          markProcessed(subscriptionKey, packName, packName)
          console.log(`Added and marked "${packName}" as processed.`)
        }
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
