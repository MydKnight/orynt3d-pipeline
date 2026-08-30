import { createReadStream } from 'node:fs'
import { readdir, stat, mkdir, rm, cp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import unzipper from 'unzipper'
import { createExtractorFromFile } from 'node-unrar-js'

export interface ExtractResult {
  extractedRoot: string
  /** The original path the user provided — always the release folder or archive, regardless of extraction */
  originalInputPath: string
  cleanup: () => Promise<void>
}

const isZip = (name: string) => name.toLowerCase().endsWith('.zip')
const isRar = (name: string) => name.toLowerCase().endsWith('.rar')
const isArchive = (name: string) => isZip(name) || isRar(name)
const stripArchiveExt = (name: string) => name.replace(/\.(zip|rar)$/i, '')

/** Extract a single ZIP to destDir. */
async function extractZipFile(zipPath: string, destDir: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    createReadStream(zipPath)
      .pipe(unzipper.Extract({ path: destDir }))
      .on('close', resolve)
      .on('error', reject)
  })
}

/** Extract a single RAR to destDir (node-unrar-js — pure WASM, no native deps). */
async function extractRarFile(rarPath: string, destDir: string): Promise<void> {
  await mkdir(destDir, { recursive: true })
  const extractor = await createExtractorFromFile({ filepath: rarPath, targetPath: destDir })
  const list = extractor.getFileList()
  const names = [...list.fileHeaders].filter(h => !h.flags.directory).map(h => h.name)
  const extracted = extractor.extract({ files: names })
  // Iterating the generator is what actually writes files to targetPath.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for (const _ of extracted.files) { /* drain */ }
}

async function extractOne(archivePath: string, destDir: string): Promise<void> {
  if (isRar(archivePath)) return extractRarFile(archivePath, destDir)
  return extractZipFile(archivePath, destDir)
}

/**
 * Extract an archive, pass through a plain folder, or extract a folder of archives.
 *
 * - Single ZIP or RAR → extracted to a temp dir
 * - Folder containing ZIPs or RARs → each archive extracted into its own subdir of a temp dir
 * - Plain folder (no archives) → returned as-is with a no-op cleanup
 *
 * A folder is not expected to mix ZIP and RAR; whichever archives it contains are all handled.
 */
export async function extractArchive(inputPath: string): Promise<ExtractResult> {
  const info = await stat(inputPath)

  if (info.isDirectory()) {
    const entries = await readdir(inputPath, { withFileTypes: true })
    const archives = entries.filter(e => e.isFile() && isArchive(e.name))

    if (archives.length > 0) {
      const tempDir = join(tmpdir(), `orynt3d-${Date.now()}`)
      await mkdir(tempDir, { recursive: true })

      for (let i = 0; i < archives.length; i++) {
        const archive = archives[i]
        process.stdout.write(`  Extracting ${i + 1}/${archives.length}: ${archive.name}...`)
        const archivePath = join(inputPath, archive.name)
        const destDir = join(tempDir, stripArchiveExt(archive.name))
        await mkdir(destDir, { recursive: true })
        try {
          await extractOne(archivePath, destDir)
          console.log(' done')
        } catch (err) {
          // Extraction failed — fall back to a pre-extracted folder alongside the archive if one exists
          const baseName = stripArchiveExt(archive.name)
          const preExtracted = join(inputPath, baseName)
          let folderExists = false
          try { folderExists = (await stat(preExtracted)).isDirectory() } catch { /* no folder */ }

          if (folderExists) {
            console.log(' failed (using pre-extracted folder)')
            await cp(preExtracted, destDir, { recursive: true })
          } else {
            console.log(' FAILED')
            await rm(tempDir, { recursive: true, force: true })
            throw new Error(`Failed to extract ${archive.name} — file may be corrupt or incomplete. Extract it manually or re-download it and try again.\n  Cause: ${err}`)
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

  // Single archive file
  const tempDir = join(tmpdir(), `orynt3d-${Date.now()}`)
  await mkdir(tempDir, { recursive: true })
  try {
    await extractOne(inputPath, tempDir)
  } catch (err) {
    await rm(tempDir, { recursive: true, force: true })
    throw new Error(`Failed to extract ${inputPath} — file may be corrupt or incomplete. Extract it manually or re-download it and try again.\n  Cause: ${err}`)
  }

  return {
    extractedRoot: tempDir,
    originalInputPath: inputPath,
    cleanup: () => rm(tempDir, { recursive: true, force: true }),
  }
}
