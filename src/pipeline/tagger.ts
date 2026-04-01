import inquirer from 'inquirer'
import type { ClassifiedModel } from '../profiles/types.js'

/**
 * Walk through every model grouped by category and prompt for content tags.
 * Structural tags (category, scale, support type) are shown but not re-asked.
 * User presses Enter to skip a model.
 * Mutates model.userTags in place.
 */
export async function tagModels(models: ClassifiedModel[]): Promise<void> {
  // Group by category for cleaner display
  const byCategory = new Map<string, ClassifiedModel[]>()
  for (const model of models) {
    const group = byCategory.get(model.category) ?? []
    group.push(model)
    byCategory.set(model.category, group)
  }

  const total = models.length
  let idx = 0

  for (const [category, group] of byCategory) {
    console.log(`\n── ${category} (${group.length} model${group.length === 1 ? '' : 's'}) ──`)

    for (const model of group) {
      idx++
      const structural = [model.category.toLowerCase(), model.scale, model.supportType === 'FDM' ? 'fdm' : 'resin']
      const hint = structural.join(', ')

      const { raw } = await inquirer.prompt<{ raw: string }>([
        {
          type: 'input',
          name: 'raw',
          message: `[${idx}/${total}] ${model.modelName}  {${hint}}\n  + tags:`,
        },
      ])

      const tags = raw
        .split(',')
        .map(t => t.trim().toLowerCase())
        .filter(t => t.length > 0)

      if (tags.length > 0) {
        model.userTags = tags
      }
    }
  }

  console.log()
}
