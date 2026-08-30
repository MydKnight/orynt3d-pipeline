import { copyFile as fsCopyFile, rename, mkdir, rm, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomBytes } from 'node:crypto'

/**
 * Error codes worth retrying — transient network / share hiccups rather than
 * real problems. Seen in practice over a VPN to an SMB share: UNKNOWN (Windows
 * catch-all for a dropped share op), EPERM (from a post-copy chmod on SMB),
 * plus the usual socket-level codes.
 */
const TRANSIENT = new Set([
  'UNKNOWN', 'EBUSY', 'EPERM', 'EACCES',
  'ECONNRESET', 'ECONNABORTED', 'ETIMEDOUT', 'ENOTCONN',
  'ENETDOWN', 'ENETUNREACH', 'EHOSTUNREACH', 'EAI_AGAIN', 'EPIPE',
])

export function isTransient(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code
  return code !== undefined && TRANSIENT.has(code)
}

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

export interface RetryOptions {
  retries?: number
  baseDelayMs?: number
  sleep?: (ms: number) => Promise<void>
  onRetry?: (attempt: number, err: unknown, delayMs: number) => void
}

/** Run `fn`, retrying on transient share/network errors with exponential backoff. */
export async function retryTransient<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const retries = opts.retries ?? 5
  const baseDelay = opts.baseDelayMs ?? 1000
  const sleep = opts.sleep ?? wait
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (attempt >= retries || !isTransient(err)) throw err
      const delay = baseDelay * 2 ** attempt
      opts.onRetry?.(attempt + 1, err, delay)
      await sleep(delay)
    }
  }
}

export interface ResilientCopyOptions {
  /** Retry attempts after the first failure. Default 5 (delays 1s, 2s, 4s, 8s, 16s). */
  retries?: number
  /** Base backoff in ms; each retry doubles it. Default 1000. */
  baseDelayMs?: number
  /** Injectable sleep, for tests. */
  sleep?: (ms: number) => Promise<void>
  /** Injectable file copy (src → dest), for tests. Defaults to fs.copyFile. */
  copyFile?: (src: string, dest: string) => Promise<void>
  /** Called before each retry with (attempt, error, delayMs). */
  onRetry?: (attempt: number, err: unknown, delayMs: number) => void
  /** Skip the same-size short-circuit and always retransfer (e.g. config files
   *  that change content without changing byte length). */
  force?: boolean
}

export interface ResilientCopyResult {
  /** True when the destination already matched by size and nothing was transferred. */
  skipped: boolean
}

async function sizeOf(path: string): Promise<number | null> {
  try {
    return (await stat(path)).size
  } catch {
    return null
  }
}

/**
 * Copy src → dest so that:
 * - an existing dest of the same size is left untouched (truncation always
 *   changes size, so partial files are recopied)
 * - dest only ever exists complete — the copy lands on `dest~<rand>.tmp` and is
 *   atomically renamed; a crash leaves the tmp, never a half-written dest
 * - transient share errors are retried with exponential backoff
 * - no chmod round-trip (plain fs.copyFile)
 */
export async function resilientCopy(
  src: string,
  dest: string,
  opts: ResilientCopyOptions = {},
): Promise<ResilientCopyResult> {
  const retries = opts.retries ?? 5
  const baseDelay = opts.baseDelayMs ?? 1000
  const sleep = opts.sleep ?? wait
  const copyFile = opts.copyFile ?? fsCopyFile

  const srcSize = (await stat(src)).size
  if (!opts.force && (await sizeOf(dest)) === srcSize) return { skipped: true }

  const tmp = `${dest}~${randomBytes(6).toString('hex')}.tmp`

  for (let attempt = 0; ; attempt++) {
    try {
      await mkdir(dirname(dest), { recursive: true })
      await copyFile(src, tmp)
      await rename(tmp, dest)
      return { skipped: false }
    } catch (err) {
      await rm(tmp, { force: true }).catch(() => {})
      if (attempt >= retries || !isTransient(err)) throw err
      const delay = baseDelay * 2 ** attempt
      opts.onRetry?.(attempt + 1, err, delay)
      await sleep(delay)
    }
  }
}
