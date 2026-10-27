export type ExportStage = 'preparing' | 'applying' | 'saving' | 'validating' | 'done'

export interface ExportProgress {
  readonly stage: ExportStage
  readonly message: string
}

export const EXPORT_STAGES: readonly { stage: ExportStage; title: string }[] = [
  { stage: 'preparing', title: 'Preparing' },
  { stage: 'applying', title: 'Applying edits' },
  { stage: 'saving', title: 'Saving' },
  { stage: 'validating', title: 'Reopening & validating' },
  { stage: 'done', title: 'Done' },
]

export function exportStageIndex(stage: ExportStage): number {
  return EXPORT_STAGES.findIndex((entry) => entry.stage === stage)
}
