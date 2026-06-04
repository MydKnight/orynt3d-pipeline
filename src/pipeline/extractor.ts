import { createReadStream } from 'node:fs'
import { readdir, stat, mkdir, rm, cp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import unzipper from 'unzipper'

export interface ExtractResult {
  extractedRoot: string
  /** The original path the user provided — always the release folder or ZIP, regardless of extraction */
  originalInputPath: string
  cleanup: () => Promise<void>
}

/**
 * Extract a ZIP, pass through a plain folder, or extract a folder of ZIPs.
 *
 * - Single ZIP → extracted to temp dir
 * - Folder containing ZIPs → each ZIP extracted into its own subdir of a temp dir
 * - Plain folder (no ZIPs) → returned as-is with no-op cleanup
 */
export async function extractZip(inputPath: string): Promise<ExtractResult> {
  const info = await stat(inputPath)

  if (info.isDirectory()) {
    const entries = await readdir(inputPath, { withFileTypes: true })
    const zips = entries.filter(e => e.isFile() && e.name.toLowerCase().endsWith('.zip'))

    if (zips.length > 0) {
      const tempDir = join(tmpdir(), `orynt3d-${Date.now()}`)
      await mkdir(tempDir, { recursive: true })

      for (let i = 0; i < zips.length; i++) {
        const zip = zips[i]
        process.stdout.write(`  Extracting ${i + 1}/${zips.length}: ${zip.name}...`)
        const zipPath = join(inputPath, zip.name)
        const destDir = join(tempDir, zip.name.replace(/\.zip$/i, ''))
        await mkdir(destDir, { recursive: true })
        try {
          await new Promise<void>((resolve, reject) => {
            createReadStream(zipPath)
              .pipe(unzipper.Extract({ path: destDir }))
              .on('close', resolve)
              .on('error', reject)
          })
          console.log(' done')
        } catch (err) {
          // ZIP failed — check if a pre-extracted folder exists alongside it
          const baseName = zip.name.replace(/\.zip$/i, '')
          const preExtracted = join(inputPath, baseName)
          let folderExists = false
          try { folderExists = (await stat(preExtracted)).isDirectory() } catch { /* no folder */ }

          if (folderExists) {
            console.log(' failed (using pre-extracted folder)')
            await cp(preExtracted, destDir, { recursive: true })
          } else {
            console.log(' FAILED')
            await rm(tempDir, { recursive: true, force: true })
            throw new Error(`Failed to extract ${zip.name} — file may be corrupt or incomplete. Extract it manually or re-download it and try again.\n  Cause: ${err}`)
          }
        }
      }

      return {
        extractedRoot: tempDir,
        originalInputPath: inputPath,
        cleanup: () => rm(tempDir, { recursive: true, force: true }),
      }
    }

    return {
      extractedRoot: inputPath,
      originalInputPath: inputPath,
      cleanup: async () => {},
    }
  }

  const tempDir = join(tmpdir(), `orynt3d-${Date.now()}`)
  await mkdir(tempDir, { recursive: true })

  await new Promise<void>((resolve, reject) => {
    createReadStream(inputPath)
      .pipe(unzipper.Extract({ path: tempDir }))
      .on('close', resolve)
      .on('error', reject)
  })

  return {
    extractedRoot: tempDir,
    originalInputPath: inputPath,
    cleanup: () => rm(tempDir, { recursive: true, force: true }),
  }
}
