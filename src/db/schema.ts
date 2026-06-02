import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

let _db: DatabaseSync | null = null

export function getDb(): DatabaseSync {
  if (_db) return _db

  const dataDir = join(process.cwd(), 'data')
  mkdirSync(dataDir, { recursive: true })

  _db = new DatabaseSync(join(dataDir, 'pipeline.db'))
  _db.exec(`
    CREATE TABLE IF NOT EXISTS releases (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      subscription    TEXT NOT NULL,
      release_name    TEXT NOT NULL,
      release_month   TEXT,
      source_url      TEXT,
      -- 1 = owned (subscribed month / purchased), 0 = not owned, NULL = unknown
      owned           INTEGER,
      downloaded_at   TEXT,
      local_path      TEXT,
      processed_at    TEXT,
      pack_name       TEXT,
      UNIQUE(subscription, release_name)
    )
  `)

  // Migrate: add owned column if it doesn't exist (existing DBs)
  try {
    _db.exec(`ALTER TABLE releases ADD COLUMN owned INTEGER`)
  } catch {
    // Column already exists — no action needed
  }

  return _db
}
