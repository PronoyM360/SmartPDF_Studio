export type DocumentRecordSource = 'demo' | 'user'

export interface DocumentRecord {
  readonly id: string
  readonly name: string
  readonly pageCount: number
  /** ISO-8601 timestamp */
  readonly lastEditedAt: string
  readonly source: DocumentRecordSource
}

export type DocumentSortKey = 'lastEdited' | 'name' | 'pageCount'

export type DocumentSortDirection = 'asc' | 'desc'
