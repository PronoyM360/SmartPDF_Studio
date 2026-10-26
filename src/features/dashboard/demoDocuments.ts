import type { DocumentRecord } from '@/types/documentRecord'

/** Sample metadata for UI development only — not backed by real PDF files. */
export const DEMO_DOCUMENTS: readonly DocumentRecord[] = [
  {
    id: 'demo-q4-proposal',
    name: 'Q4 Marketing Proposal.pdf',
    pageCount: 18,
    lastEditedAt: '2026-10-15T14:22:00.000Z',
    source: 'demo',
  },
  {
    id: 'demo-handbook',
    name: 'Employee Handbook 2026.pdf',
    pageCount: 42,
    lastEditedAt: '2026-10-10T09:05:00.000Z',
    source: 'demo',
  },
  {
    id: 'demo-invoice-pack',
    name: 'Client Invoice Pack — September.pdf',
    pageCount: 6,
    lastEditedAt: '2026-10-02T16:40:00.000Z',
    source: 'demo',
  },
  {
    id: 'demo-wireframes',
    name: 'Product Wireframes v3.pdf',
    pageCount: 24,
    lastEditedAt: '2026-09-28T11:18:00.000Z',
    source: 'demo',
  },
]
