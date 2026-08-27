import inquirer from 'inquirer'
import { getAllReleases, markDownloaded, markOwned, markProcessed, upsertRelease, getStatusSummary, getGaps } from './db/releases.js'
import { loadEnv } from './util/env.js'

/**
 * Subscriptions the tracker knows about. A subscription can be tracked here
 * (ownership / download / import state, gap reports) before it has a pipeline
 * profile. Keys must match the key a future profile would generate:
 * `profile.name.toLowerCase().replace(/\s+/g, '')`.
 */
const SUBSCRIPTIONS: { key: string; label: string; hasProfile: boolean }[] = [
  { key: 'lootstudios', label: 'Loot Studios', hasProfile: true },
  { key: 'fleshofgods', label: 'Flesh of Gods', hasProfile: true },
  { key: 'rescale', label: 'Rescale', hasProfile: true },
  { key: 'dmstash', label: 'DM Stash', hasProfile: false },
  { key: 'archvillaingames', label: 'Archvillain Games', hasProfile: false },
]

const SUB_KEYS = SUBSCRIPTIONS.map(s => s.key)
const SUB_LABELS: Record<string, string> = Object.fromEntries(
  SUBSCRIPTIONS.map(s => [s.key, s.label]),
)

function stateLabel(r: ReturnType<typeof getAllReleases>[0]): string {
  if (r.processed_at) return '✓ imported'
  if (r.downloaded_at) return '↓ downloaded'
  if (r.owned === 1) return '○ owned'
  if (r.owned === 0) return '✗ not owned'
  return '? unknown'
}

function printStatus(subscription: string): void {
  const s = getStatusSummary(subscription)
  const total = s.imported + s.downloadedNotImported + s.ownedNotDownloaded + s.notOwned + s.unknown
  if (total === 0) return
  console.log(`  ${subscription}`)
  console.log(`    ✓ Imported:           ${s.imported}`)
  if (s.downloadedNotImported) console.log(`    ↓ Downloaded, not imported: ${s.downloadedNotImported}`)
  if (s.ownedNotDownloaded)   console.log(`    ○ Owned, not downloaded:    ${s.ownedNotDownloaded}`)
  if (s.notOwned)             console.log(`    ✗ Not owned:             ${s.notOwned}`)
  if (s.unknown)              console.log(`    ? Unknown:               ${s.unknown}`)
  console.log()
}

async function main(): Promise<void> {
  await loadEnv()

  console.log('\n=== orynt3d-pipeline tracker ===\n')

  const { action } = await inquirer.prompt<{ action: string }>([
    {
      type: 'list',
      name: 'action',
      message: 'What would you like to do?',
      choices: [
        { name: 'Show release status', value: 'status' },
        { name: 'What am I missing?', value: 'gaps' },
        { name: 'List releases for a subscription', value: 'list' },
        { name: 'Mark a release as already imported (backfill)', value: 'backfill' },
        { name: 'Mark a release as owned/downloaded (manual download)', value: 'manual' },
        { name: 'Mark releases as not owned', value: 'not-owned' },
      ],
    },
  ])

  if (action === 'status') {
    console.log()
    for (const sub of SUB_KEYS) {
      printStatus(sub)
    }
    return
  }

  if (action === 'gaps') {
    console.log()
    let anyGaps = false
    for (const sub of SUB_KEYS) {
      const gaps = getGaps(sub)
      if (gaps.length === 0) continue
      anyGaps = true
      console.log(`  ${SUB_LABELS[sub]}`)
      for (const month of gaps) console.log(`    ? ${month}  — not imported`)
      console.log()
    }
    if (!anyGaps) console.log('  All tracked subscriptions up to date.\n')
    return
  }

  if (action === 'list') {
    const { subscription } = await inquirer.prompt<{ subscription: string }>([
      {
        type: 'list',
        name: 'subscription',
        message: 'Which subscription?',
        choices: SUB_KEYS,
      },
    ])
    const releases = getAllReleases(subscription)
    if (releases.length === 0) { console.log('\n  No releases tracked yet.'); return }
    console.log()
    for (const r of releases) {
      console.log(`  ${r.release_month ?? '????-??'}  ${stateLabel(r).padEnd(16)}  ${r.release_name}`)
    }
    console.log(`\n  Total: ${releases.length}`)
    return
  }

  if (action === 'backfill') {
    console.log('\nEnter releases already imported into Orynt3D. Empty release name to stop.\n')
    const { subscription } = await inquirer.prompt<{ subscription: string }>([
      {
        type: 'list',
        name: 'subscription',
        message: 'Which subscription?',
        choices: SUB_KEYS,
      },
    ])

    let count = 0
    while (true) {
      const { releaseName } = await inquirer.prompt<{ releaseName: string }>([
        {
          type: 'input',
          name: 'releaseName',
          message: `Release name (Enter to finish):`,
        },
      ])
      if (!releaseName.trim()) break

      const { releaseMonth } = await inquirer.prompt<{ releaseMonth: string }>([
        {
          type: 'input',
          name: 'releaseMonth',
          message: 'Release month (YYYY-MM):',
          validate: v => /^\d{4}-\d{2}$/.test(v.trim()) || 'Format must be YYYY-MM',
        },
      ])

      const name = releaseName.trim()
      const month = releaseMonth.trim()
      upsertRelease({ subscription, release_name: name, release_month: month, owned: true })
      markProcessed(subscription, name, name)
      console.log(`  ✓ ${month} — ${name}`)
      count++
    }
    console.log(`\nBackfilled ${count} release(s).`)
    return
  }

  if (action === 'manual') {
    const { subscription, releaseName, releaseMonth, localPath } = await inquirer.prompt<{
      subscription: string
      releaseName: string
      releaseMonth: string
      localPath: string
    }>([
      {
        type: 'list',
        name: 'subscription',
        message: 'Which subscription?',
        choices: SUB_KEYS,
      },
      {
        type: 'input',
        name: 'releaseName',
        message: 'Release name:',
        validate: v => v.trim().length > 0 || 'Required',
      },
      {
        type: 'input',
        name: 'releaseMonth',
        message: 'Release month (YYYY-MM, or Enter to skip):',
      },
      {
        type: 'input',
        name: 'localPath',
        message: 'Path to downloaded file/folder (or Enter to skip):',
      },
    ])

    const month = releaseMonth.trim() || undefined
    const path = localPath.trim() || undefined

    upsertRelease({ subscription, release_name: releaseName.trim(), release_month: month, owned: true })
    if (path) markDownloaded(subscription, releaseName.trim(), path)

    console.log(`Marked "${releaseName.trim()}" as owned${path ? ' and downloaded' : ''}.`)
    return
  }

  if (action === 'not-owned') {
    const { subscription } = await inquirer.prompt<{ subscription: string }>([
      {
        type: 'list',
        name: 'subscription',
        message: 'Which subscription?',
        choices: SUB_KEYS,
      },
    ])
    const all = getAllReleases(subscription).filter(r => r.owned !== 0)
    if (all.length === 0) { console.log('No releases to mark.'); return }

    const { selected } = await inquirer.prompt<{ selected: string[] }>([
      {
        type: 'checkbox',
        name: 'selected',
        message: 'Select releases to mark as NOT owned:',
        choices: all.map(r => ({
          name: `${r.release_month ?? '????-??'} — ${r.release_name}`,
          value: r.release_name,
        })),
        pageSize: 20,
      },
    ])
    for (const name of selected) markOwned(subscription, name, false)
    console.log(`Marked ${selected.length} release(s) as not owned.`)
  }
}

main().catch(err => {
  console.error('\nFatal error:', err)
  process.exit(1)
})
