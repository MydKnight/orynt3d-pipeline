import { writeFile, access } from 'node:fs/promises'
import { join } from 'node:path'
import type { ClassifiedModel } from '../profiles/types.js'

interface OryTagSet {
  include: string[]
  exclude: string[]
  clear: boolean
}

interface OryAttribute {
  key: string
  value: string
}

interface OryAttributeSet {
  include: OryAttribute[]
  exclude: string[]
  clear: boolean
}

interface OryConfig {
  version: 5
  scancfg: {
    fileMode: 0
    modelMode: number
    ifLeaf: boolean
    filetypes: [1]
    autotags: 1
    archives: 0
    thumbnails: 0
    propagation: 0
    tags: OryTagSet
    attributes: OryAttributeSet
  }
  modelmeta: {
    name: string | null
    notes: string
    tags: []
    cover: null
    collections: []
    attributes: []
  }
}

function buildConfig(opts: {
  modelMode: number
  tags?: string[]
  attributes?: OryAttribute[]
  name?: string
}): OryConfig {
  return {
    version: 5,
    scancfg: {
      fileMode: 0,
      modelMode: opts.modelMode,
      ifLeaf: false,
      filetypes: [1],
      autotags: 1,
      archives: 0,
      thumbnails: 0,
      propagation: 0,
      tags: { include: opts.tags ?? [], exclude: [], clear: false },
      attributes: { include: opts.attributes ?? [], exclude: [], clear: false },
    },
    modelmeta: {
      name: opts.name ?? null,
      notes: '',
      tags: [],
      cover: null,
      collections: [],
      attributes: [],
    },
  }
}

async function writeConfigIfAbsent(filePath: string, config: OryConfig): Promise<void> {
  try {
    await access(filePath)
    // File exists — don't overwrite (may have manual additions)
  } catch {
    await writeFile(filePath, JSON.stringify(config, null, 2), 'utf8')
  }
}

async function writeConfigAlways(filePath: string, config: OryConfig): Promise<void> {
  await writeFile(filePath, JSON.stringify(config, null, 2), 'utf8')
}

/** Write subscription-level config (once per subscription folder, skip if already exists) */
export async function writeSubscriptionConfig(
  subscriptionFolder: string,
  subscriptionName: string,
): Promise<void> {
  const config = buildConfig({
    modelMode: 2,
    attributes: [{ key: 'subscription', value: subscriptionName.toLowerCase().replace(/ /g, '') }],
  })
  await writeConfigIfAbsent(join(subscriptionFolder, 'config.orynt3d'), config)
}

/** Write pack-level config (once per pack folder, skip if already exists) */
export async function writePackConfig(
  packFolder: string,
  packName: string,
  scale: string,
): Promise<void> {
  const config = buildConfig({
    modelMode: 2,
    attributes: [
      { key: 'release', value: packName.toLowerCase() },
      { key: 'scale', value: scale },
    ],
  })
  await writeConfigIfAbsent(join(packFolder, 'config.orynt3d'), config)
}

/** Write model-level config (always write — each run is a fresh model) */
export async function writeModelConfig(
  modelFolder: string,
  model: ClassifiedModel,
): Promise<void> {
  const printType = model.supportType === 'FDM' ? 'fdm' : 'resin'
  const supportTag = model.supportType === 'ReadyToSlice' ? 'pre-supported' : model.supportType.toLowerCase()

  const tags = [
    ...(model.classificationTag ? [model.classificationTag] : []),
    model.scale,
    printType,
    supportTag,
    ...(model.userTags ?? []),
  ]

  const config = buildConfig({
    modelMode: 0,
    tags,
    name: model.modelName,
  })
  await writeConfigAlways(join(modelFolder, 'config.orynt3d'), config)
}
