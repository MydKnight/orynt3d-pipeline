export type SupportType = 'ReadyToSlice' | 'Lychee' | 'Unsupported' | 'FDM'

export interface ClassifiedModel {
  /** e.g. "Greenbrooke Invasion" */
  packName: string
  /** e.g. "32mm" | "75mm" */
  scale: string
  /** e.g. "Enemies" | "Heroes" | "Environment" | "Prop" */
  category: string
  /** Clean display name, title-cased, no scale/support suffixes — e.g. "Battering Beast" */
  modelName: string
  supportType: SupportType
  /** Absolute path to the model's folder in the extracted temp directory */
  sourceFolder: string
  /** STL/3MF files found inside sourceFolder */
  files: string[]
  /** Content tags added interactively by the user (e.g. "male", "human", "warlock") */
  userTags?: string[]
}

export interface ProfileFilter {
  /** Which support types to include in the output */
  include: SupportType[]
  /**
   * When true, FDM variants are brought into the pipeline.
   * If a model has both FDM and a non-FDM included type, the TUI will ask which to use.
   */
  includeFDM: boolean
}

export interface SubscriptionProfile {
  /** Display name — also used as the NAS subfolder name (e.g. "Loot Studios") */
  name: string

  /**
   * Walk the extracted download root folder and return a ClassifiedModel for every
   * leaf model folder found. Unrecognised folders should be omitted and logged —
   * the pipeline's review step handles the residue.
   */
  classify(rootFolder: string): Promise<ClassifiedModel[]>

  filter: ProfileFilter

  /** Format the pack-level NAS folder name from extracted pack + scale */
  formatPackFolder(packName: string, scale: string): string

  /** Format the model-level NAS folder name from the clean model name */
  formatModelFolder(modelName: string): string
}
