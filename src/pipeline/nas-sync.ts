import { spawn } from 'node:child_process'
import { mkdir, readdir, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import type { ClassifiedModel, SubscriptionProfile } from '../profiles/types.js'
import { writeSubscriptionConfig, writePackConfig } from './config-writer.js'
import { resilientCopy, retryTransient } from './resilient-copy.js'

/**
 * Subscription- and pack-level configs are "write once, never overwrite" and
 * must be checked against the real NAS (not staging). Small files — written
 * directly, with retry, and kept out of the robocopy set so a staged copy can
 * never clobber a config that has manual edits.
 */
export async function writeNasConfigs(
  models: ClassifiedModel[],
  profile: SubscriptionProfile,
  nasRoot: string,
): Promise<void> {
  const subscriptionFolder = join(nasRoot, profile.name)
  await retryTransient(() => mkdir(subscriptionFolder, { recursive: true }))
  await retryTransient(() => writeSubscriptionConfig(subscriptionFolder, profile.name))

  const seen = new Set<string>()
  for (const model of models) {
    const packFolder = join(subscriptionFolder, profile.formatPackFolder(model.packName, model.scale))
    if (seen.has(packFolder)) continue
    seen.add(packFolder)
    await retryTransient(() => mkdir(packFolder, { recursive: true }))
    await retryTransient(() => writePackConfig(packFolder, model.packName, model.scale))
  }
}

export interface SyncResult {
  method: 'robocopy' | 'fallback'
  copied: number
  skipped: number
}

/**
 * Transfer a staged subscription tree to the NAS.
 *
 * On Windows: `robocopy /Z` (restartable — resumes a partial file mid-byte,
 * retries each file, re-sends only what changed). Elsewhere / if robocopy is
 * missing: a resilient tree walk (size-skip + retry, no mid-file resume).
 *
 * @param stagedSubscriptionRoot  the `stagingRoot` returned by reorganize()
 * @param nasRoot                 the NAS "3D Files" root
 */
export async function syncToNas(
  stagedSubscriptionRoot: string,
  nasRoot: string,
  profile: SubscriptionProfile,
  opts: { onOutput?: (chunk: string) => void } = {},
): Promise<SyncResult> {
  const onOutput = opts.onOutput ?? ((c: string) => process.stdout.write(c))
  const dest = join(nasRoot, profile.name)
  await mkdir(dest, { recursive: true }).catch(() => {})

  if (process.platform === 'win32' && await hasRobocopy()) {
    return robocopySync(stagedSubscriptionRoot, dest, onOutput)
  }
  onOutput('  (robocopy unavailable — using resilient fallback copy)\n')
  return fallbackSync(stagedSubscriptionRoot, dest)
}

function hasRobocopy(): Promise<boolean> {
  return new Promise(resolve => {
    const p = spawn('robocopy', ['/?'], { stdio: 'ignore' })
    p.on('error', () => resolve(false))
    p.on('close', () => resolve(true))
  })
}

function robocopySync(src: string, dest: string, onOutput: (c: string) => void): Promise<SyncResult> {
  return new Promise((resolve, reject) => {
    // /FFT — 2-second timestamp granularity, so NTFS-vs-SMB precision differences
    // don't make robocopy re-copy unchanged files on every run.
    const args = [src, dest, '/E', '/Z', '/FFT', '/R:10', '/W:15', '/NP', '/NDL', '/XF', '*.tmp']
    const p = spawn('robocopy', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    p.stdout.on('data', d => { out += d; onOutput(String(d)) })
    p.stderr.on('data', d => onOutput(String(d)))
    p.on('error', reject)
    p.on('close', code => {
      // robocopy: 0-7 are success variants, >=8 is a failure
      if (code === null || code >= 8) {
        reject(new Error(`robocopy failed (exit ${code}). Reconnect and run \`npm run sync\` to resume.`))
        return
      }
      const copied = Number(out.match(/Files :\s+\d+\s+(\d+)/)?.[1] ?? 0)
      const skipped = Number(out.match(/Files :\s+\d+\s+\d+\s+(\d+)/)?.[1] ?? 0)
      resolve({ method: 'robocopy', copied, skipped })
    })
  })
}

async function fallbackSync(src: string, dest: string): Promise<SyncResult> {
  const entries = await readdir(src, { recursive: true, withFileTypes: true })
  let copied = 0
  let skipped = 0
  for (const entry of entries) {
    if (!entry.isFile()) continue
    if (entry.name.endsWith('.tmp')) continue
    const parent = (entry as unknown as { parentPath?: string; path: string }).parentPath
      ?? (entry as unknown as { path: string }).path
    const abs = join(parent, entry.name)
    const rel = relative(src, abs)
    // config.orynt3d is rewritten each run and can change content without
    // changing size — robocopy catches this via /FFT timestamps; here we force it.
    const res = await resilientCopy(abs, join(dest, rel), { force: entry.name === 'config.orynt3d' })
    if (res.skipped) skipped++
    else copied++
  }
  return { method: 'fallback', copied, skipped }
}

/** Total bytes / file count under a staging tree, for a progress header. */
export async function stagingSize(root: string): Promise<{ files: number; bytes: number }> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true }).catch(() => [])
  let files = 0
  let bytes = 0
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const parent = (entry as unknown as { parentPath?: string; path: string }).parentPath
      ?? (entry as unknown as { path: string }).path
    files++
    bytes += (await stat(join(parent, entry.name)).catch(() => ({ size: 0 }))).size
  }
  return { files, bytes }
}
