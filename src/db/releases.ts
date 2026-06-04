import { getDb } from './schema.js'

export interface Release {
  id: number
  subscription: string
  release_name: string
  release_month: string | null
  source_url: string | null
  /** 1 = owned, 0 = not owned, null = unknown */
  owned: number | null
  downloaded_at: string | null
  local_path: string | null
  processed_at: string | null
  pack_name: string | null
}

/** Insert a newly discovered release. Ignored if already exists (UNIQUE constraint). */
export function upsertRelease(opts: {
  subscription: string
  release_name: string
  release_month?: string
  source_url?: string
  owned?: boolean
}): void {
  const db = getDb()
  db.prepare(`
    INSERT INTO releases (subscription, release_name, release_month, source_url, owned)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(subscription, release_name) DO UPDATE SET
      source_url = COALESCE(excluded.source_url, source_url),
      release_month = COALESCE(excluded.release_month, release_month),
      owned = CASE WHEN excluded.owned IS NOT NULL THEN excluded.owned ELSE owned END
  `).run(
    opts.subscription,
    opts.release_name,
    opts.release_month ?? null,
    opts.source_url ?? null,
    opts.owned != null ? (opts.owned ? 1 : 0) : null,
  )
}

/** Mark a release as owned (or not owned). */
export function markOwned(subscription: string, release_name: string, owned: boolean): void {
  const db = getDb()
  db.prepare(`
    UPDATE releases SET owned = ? WHERE subscription = ? AND release_name = ?
  `).run(owned ? 1 : 0, subscription, release_name)
}

/** Mark a release as downloaded and record where it was saved. Also sets owned=1. */
export function markDownloaded(subscription: string, release_name: string, local_path: string): void {
  const db = getDb()
  db.prepare(`
    UPDATE releases
    SET downloaded_at = ?, local_path = ?, owned = 1
    WHERE subscription = ? AND release_name = ?
  `).run(new Date().toISOString(), local_path, subscription, release_name)
}

/** Mark a release as processed by the pipeline. */
export function markProcessed(subscription: string, release_name: string, pack_name: string): void {
  const db = getDb()
  db.prepare(`
    UPDATE releases
    SET processed_at = ?, pack_name = ?, owned = 1
    WHERE subscription = ? AND release_name = ?
  `).run(new Date().toISOString(), pack_name, subscription, release_name)
}

/** Returns true if the release has already been processed by the pipeline. */
export function isProcessed(subscription: string, release_name: string): boolean {
  const db = getDb()
  const row = db.prepare(`
    SELECT processed_at FROM releases
    WHERE subscription = ? AND release_name = ?
  `).get(subscription, release_name) as { processed_at: string | null } | undefined
  return !!(row?.processed_at)
}

/**
 * Returns true if any release for this subscription has been processed
 * with a matching pack_name OR release_name. Use for pre-flight duplicate
 * checks where the pack name may differ from the stored release_name.
 */
export function isPackProcessed(subscription: string, pack_name: string): boolean {
  const db = getDb()
  const row = db.prepare(`
    SELECT processed_at FROM releases
    WHERE subscription = ? AND (release_name = ? OR pack_name = ?) AND processed_at IS NOT NULL
    LIMIT 1
  `).get(subscription, pack_name, pack_name) as { processed_at: string | null } | undefined
  return !!(row?.processed_at)
}

/**
 * Returns months with no processed release, from the earliest tracked month
 * up to (but not including) the current month.
 */
export function getGaps(subscription: string): string[] {
  const db = getDb()

  const firstRow = db.prepare(`
    SELECT MIN(release_month) as first FROM releases
    WHERE subscription = ? AND release_month IS NOT NULL
  `).get(subscription) as { first: string | null } | undefined
  if (!firstRow?.first) return []

  const processedMonths = new Set(
    (db.prepare(`
      SELECT DISTINCT release_month FROM releases
      WHERE subscription = ? AND processed_at IS NOT NULL AND release_month IS NOT NULL
    `).all(subscription) as { release_month: string }[]).map(r => r.release_month)
  )

  const gaps: string[] = []
  const [sy, sm] = firstRow.first.split('-').map(Number)
  const now = new Date()
  const [ey, em] = [now.getFullYear(), now.getMonth() + 1] // current month excluded

  let y = sy, m = sm
  while (y < ey || (y === ey && m < em)) {
    const key = `${y}-${String(m).padStart(2, '0')}`
    if (!processedMonths.has(key)) gaps.push(key)
    m++; if (m > 12) { m = 1; y++ }
  }

  return gaps
}

/** Returns owned releases not yet processed, ordered by month. */
export function getPendingReleases(subscription: string): Release[] {
  const db = getDb()
  return db.prepare(`
    SELECT * FROM releases
    WHERE subscription = ? AND owned = 1 AND downloaded_at IS NOT NULL AND processed_at IS NULL
    ORDER BY release_month ASC, release_name ASC
  `).all(subscription) as unknown as Release[]
}

/** Returns all releases for a subscription, regardless of state. */
export function getAllReleases(subscription: string): Release[] {
  const db = getDb()
  return db.prepare(`
    SELECT * FROM releases
    WHERE subscription = ?
    ORDER BY release_month DESC, release_name ASC
  `).all(subscription) as unknown as Release[]
}

/** Status summary for a subscription — counts by state. */
export function getStatusSummary(subscription: string): {
  imported: number
  downloadedNotImported: number
  ownedNotDownloaded: number
  notOwned: number
  unknown: number
} {
  const db = getDb()
  const rows = db.prepare(`SELECT owned, downloaded_at, processed_at FROM releases WHERE subscription = ?`)
    .all(subscription) as { owned: number | null; downloaded_at: string | null; processed_at: string | null }[]

  let imported = 0, downloadedNotImported = 0, ownedNotDownloaded = 0, notOwned = 0, unknown = 0
  for (const r of rows) {
    if (r.processed_at) { imported++; continue }
    if (r.downloaded_at) { downloadedNotImported++; continue }
    if (r.owned === 1) { ownedNotDownloaded++; continue }
    if (r.owned === 0) { notOwned++; continue }
    unknown++
  }
  return { imported, downloadedNotImported, ownedNotDownloaded, notOwned, unknown }
}
