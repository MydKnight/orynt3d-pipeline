export type SupportType = 'ReadyToSlice' | 'Lychee' | 'Unsupported' | 'FDM'

export type ClassificationTag = 'hero' | 'monster' | 'npc' | 'terrain' | 'scatter' | 'building' | 'prop'

export interface CategoryMapping {
  /** Auto-assign this tag — no prompt needed */
  tag?: ClassificationTag
  /** Prompt user to choose from these options */
  options?: ClassificationTag[]
}

export interface ClassifiedModel {
  /** e.g. "Greenbrooke Invasion" */
  packName: string
  /** e.g. "32mm" | "75mm" */
  scale: string
  /** Raw category name from the subscription's folder structure e.g. "Enemies" | "Heroes" */
  category: string
  /** Clean display name, title-cased, no scale/support suffixes — e.g. "Battering Beast" */
  modelName: string
  supportType: SupportType
  /** Normalized classification tag assigned during tagging step */
  classificationTag?: ClassificationTag
  /** Absolute path to the model's folder in the extracted temp directory */
  sourceFolder: string
  /** STL/3MF files found inside sourceFolder */
  files: string[]
  /** Content tags added interactively by the user (e.g. "male", "human", "warlock") */
  userTags?: string[]
  /** Image URL provided during tagging — fetched and saved to model folder by reorganizer */
  imageUrl?: string
  /**
   * Override folder for image copying. When set, reorganizer copies images from here
   * instead of sourceFolder. Used when images live in a subfolder (e.g. Renders/)
   * or at a parent level (e.g. shared Pack group image).
   */
  imageSourceFolder?: string
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
   * Maps the subscription's raw category folder names to classification tags.
   * Auto-mapped categories need no user prompt.
   * Option-mapped categories prompt the user to choose.
   * Unknown categories fall through to a full-vocabulary prompt.
   */
  categoryMappings: Record<string, CategoryMapping>

  /**
   * Whether the subscription's ZIP includes images inside model folders.
   * If true, the reorganizer copies them automatically.
   * If false, the pipeline optionally asks for an image URL per model.
   */
  includesImages: boolean

  /**
   * Walk the extracted download root folder and return a ClassifiedModel for every
   * leaf model folder found. Unrecognised folders should be omitted and logged —
   * the pipeline's review step handles the residue.
   */
  classify(rootFolder: string, originalInputPath?: string): Promise<ClassifiedModel[]>

  filter: ProfileFilter

  /** Format the pack-level NAS folder name */
  formatPackFolder(packName: string, scale: string): string

  /** Format the model-level NAS folder name from the clean model name */
  formatModelFolder(modelName: string): string
}
