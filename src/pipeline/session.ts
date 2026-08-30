import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { ClassifiedModel } from '../profiles/types.js'

const SESSIONS_DIR = 'sessions'

interface SessionModel {
  key: string
  classificationTag?: string
  userTags?: string[]
  imageUrl?: string
}

interface Session {
  zipName: string
  subscription: string
  savedAt: string
  models: SessionModel[]
}

function modelKey(m: ClassifiedModel): string {
  return `${m.packName}|${m.category}|${m.modelName}|${m.supportType}`
}

function sessionPath(zipPath: string): string {
  const zipName = zipPath.split(/[\\/]/).at(-1)!.replace(/\.(zip|rar)$/i, '')
  return join(SESSIONS_DIR, `${zipName}.session.json`)
}

export async function saveSession(
  zipPath: string,
  subscription: string,
  models: ClassifiedModel[],
): Promise<string> {
  const session: Session = {
    zipName: zipPath.split(/[\\/]/).at(-1)!,
    subscription,
    savedAt: new Date().toISOString(),
    models: models.map(m => ({
      key: modelKey(m),
      classificationTag: m.classificationTag,
      userTags: m.userTags,
      imageUrl: m.imageUrl,
    })),
  }
  const path = sessionPath(zipPath)
  await mkdir(SESSIONS_DIR, { recursive: true })
  await writeFile(path, JSON.stringify(session, null, 2), 'utf8')
  return path
}

export async function loadSession(
  zipPath: string,
  models: ClassifiedModel[],
): Promise<boolean> {
  const path = sessionPath(zipPath)
  let session: Session
  try {
    session = JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return false
  }

  const byKey = new Map(session.models.map(m => [m.key, m]))
  for (const model of models) {
    const saved = byKey.get(modelKey(model))
    if (!saved) continue
    if (saved.classificationTag) model.classificationTag = saved.classificationTag as ClassifiedModel['classificationTag']
    if (saved.userTags) model.userTags = saved.userTags
    if (saved.imageUrl) model.imageUrl = saved.imageUrl
  }

  console.log(`  Session from ${new Date(session.savedAt).toLocaleString()} loaded.`)
  return true
}

export async function hasSession(zipPath: string): Promise<boolean> {
  try {
    await readFile(sessionPath(zipPath), 'utf8')
    return true
  } catch {
    return false
  }
}
