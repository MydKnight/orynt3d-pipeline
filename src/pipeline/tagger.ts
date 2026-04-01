import inquirer from 'inquirer'
import type { ClassifiedModel, ClassificationTag, SubscriptionProfile } from '../profiles/types.js'

const ALL_CLASSIFICATION_TAGS: ClassificationTag[] = [
  'hero', 'monster', 'npc', 'terrain', 'scatter', 'building', 'prop',
]

/**
 * Phase 1: assign classification tags (hero/monster/npc/terrain/etc.)
 * Works at the category level — asks once per group when possible.
 *
 * Phase 2: per-model content tags (race, class, gender, etc.)
 * User types comma-separated tags or presses Enter to skip.
 *
 * Mutates model.classificationTag and model.userTags in place.
 */
export async function tagModels(
  models: ClassifiedModel[],
  profile: SubscriptionProfile,
): Promise<void> {
  // Group by category
  const byCategory = new Map<string, ClassifiedModel[]>()
  for (const model of models) {
    const group = byCategory.get(model.category) ?? []
    group.push(model)
    byCategory.set(model.category, group)
  }

  // ── Phase 1: classification tags ──────────────────────────────────────────

  console.log('\n── Classification ──────────────────────────────────────────')

  for (const [category, group] of byCategory) {
    const mapping = profile.categoryMappings[category]

    if (mapping?.tag) {
      // Auto-mapped — no prompt needed
      for (const model of group) model.classificationTag = mapping.tag
      console.log(`  ${category} (${group.length}) → ${mapping.tag} (auto)`)
      continue
    }

    const options = mapping?.options ?? ALL_CLASSIFICATION_TAGS
    const label = `${category} (${group.length} model${group.length === 1 ? '' : 's'})`

    // Ask if the whole group is the same type
    const { sameForAll } = await inquirer.prompt<{ sameForAll: boolean }>([
      {
        type: 'confirm',
        name: 'sameForAll',
        message: `${label} — are all the same type?`,
        default: true,
      },
    ])

    if (sameForAll) {
      const { tag } = await inquirer.prompt<{ tag: ClassificationTag }>([
        {
          type: 'list',
          name: 'tag',
          message: `  Type for all ${category}:`,
          choices: options,
        },
      ])
      for (const model of group) model.classificationTag = tag
    } else {
      for (const model of group) {
        const { tag } = await inquirer.prompt<{ tag: ClassificationTag }>([
          {
            type: 'list',
            name: 'tag',
            message: `  ${model.modelName}:`,
            choices: options,
          },
        ])
        model.classificationTag = tag
      }
    }
  }

  // ── Phase 2: content tags ─────────────────────────────────────────────────

  console.log('\n── Content tags (Enter to skip) ────────────────────────────')

  const total = models.length
  let idx = 0

  for (const [category, group] of byCategory) {
    console.log(`\n  ${category}`)
    for (const model of group) {
      idx++
      const hint = [model.classificationTag, model.scale, model.supportType === 'FDM' ? 'fdm' : 'resin']
        .filter(Boolean)
        .join(', ')

      const { raw } = await inquirer.prompt<{ raw: string }>([
        {
          type: 'input',
          name: 'raw',
          message: `  [${idx}/${total}] ${model.modelName}  {${hint}}\n    + tags:`,
        },
      ])

      const tags = raw
        .split(',')
        .map(t => t.trim().toLowerCase())
        .filter(t => t.length > 0)

      if (tags.length > 0) model.userTags = tags
    }
  }

  console.log()

  // ── Phase 3: images ───────────────────────────────────────────────────────

  if (!profile.includesImages) {
    console.log('── Images (Enter to skip, "done" to skip remaining) ────────')

    for (const [, group] of byCategory) {
      for (const model of group) {
        const { url } = await inquirer.prompt<{ url: string }>([
          {
            type: 'input',
            name: 'url',
            message: `  ${model.modelName}  image URL:`,
          },
        ])

        const trimmed = url.trim()
        if (trimmed.toLowerCase() === 'done') {
          console.log('  Skipping remaining images.')
          return
        }
        if (trimmed.length > 0) {
          model.imageUrl = trimmed
        }
      }
    }

    console.log()
  }
}
