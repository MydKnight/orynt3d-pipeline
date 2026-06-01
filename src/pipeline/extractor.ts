import { createReadStream } from 'node:fs'
import { stat, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import unzipper from 'unzipper'

/**
 * Extract a ZIP file to a temp folder, or use the folder directly if a directory is given.
 * Returns the path to the extracted root folder and a cleanup function.
 */
export async function extractZip(zipPath: string): Promise<{ extractedRoot: string; cleanup: () => Promise<void> }> {
  const info = await stat(zipPath)
  if (info.isDirectory()) {
    return {
      extractedRoot: zipPath,
      cleanup: async () => {},
    }
  }

  const tempDir = join(tmpdir(), `orynt3d-${Date.now()}`)
  await mkdir(tempDir, { recursive: true })

  await new Promise<void>((resolve, reject) => {
    createReadStream(zipPath)
      .pipe(unzipper.Extract({ path: tempDir }))
      .on('close', resolve)
      .on('error', reject)
  })

  return {
    extractedRoot: tempDir,
    cleanup: () => rm(tempDir, { recursive: true, force: true }),
  }
}
