import inquirer from 'inquirer'
import type { ClassifiedModel } from '../profiles/types.js'
import type { FDMConflict } from './filter.js'

export interface ReviewResult {
  resolved: ClassifiedModel[]
}

/**
 * For each FDM conflict, ask the user which version to import.
 * Returns the final resolved list to add to the included set.
 */
export async function reviewConflicts(conflicts: FDMConflict[]): Promise<ReviewResult> {
  if (conflicts.length === 0) return { resolved: [] }

  console.log(`\n${conflicts.length} model(s) have both a Resin (ReadyToSlice) and FDM version.\n`)

  const resolved: ClassifiedModel[] = []

  for (const conflict of conflicts) {
    const answers = await inquirer.prompt<{ choice: 'resin' | 'fdm' | 'both' | 'skip' }>([
      {
        type: 'list',
        name: 'choice',
        message: `${conflict.resin.category} › ${conflict.resin.modelName}`,
        choices: [
          { name: 'Resin — ReadyToSlice', value: 'resin' },
          { name: 'FDM', value: 'fdm' },
          { name: 'Both', value: 'both' },
          { name: 'Skip (import neither)', value: 'skip' },
        ],
      },
    ])

    if (answers.choice === 'resin') resolved.push(conflict.resin)
    else if (answers.choice === 'fdm') resolved.push(conflict.fdm)
    else if (answers.choice === 'both') resolved.push(conflict.resin, conflict.fdm)
    // 'skip' → push nothing
  }

  return { resolved }
}
