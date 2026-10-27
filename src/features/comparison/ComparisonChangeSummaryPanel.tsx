import { Typography } from 'antd'
import { ChangeSummaryPanel } from '@/features/changes/ChangeSummaryPanel'
import type { ComparisonChangeSummary } from '@/features/comparison/buildComparisonChangeSummary'
import styles from './ComparisonChangeSummaryPanel.module.css'

const { Text } = Typography

interface ComparisonChangeSummaryPanelProps {
  summary: ComparisonChangeSummary
  activePage: number
  pageCount: number
  currentPageVisualDiff: boolean | null
  onNavigateToPage: (pageNumber: number) => void
}

function StatRow({
  label,
  value,
  unavailable,
}: {
  label: string
  value: number | string
  unavailable?: string
}) {
  return (
    <div className={styles.row}>
      <Text type="secondary">{label}</Text>
      {unavailable ? (
        <Text className={styles.valueMuted}>{unavailable}</Text>
      ) : (
        <Text strong className={styles.value}>
          {value}
        </Text>
      )}
    </div>
  )
}

export function ComparisonChangeSummaryPanel({
  summary,
  activePage,
  pageCount,
  currentPageVisualDiff,
  onNavigateToPage,
}: ComparisonChangeSummaryPanelProps) {
  return (
    <aside className={styles.panel} aria-label="Change summary">
      <ChangeSummaryPanel onNavigateToPage={onNavigateToPage} />

      <div className={styles.divider} />

      <Text strong className={styles.title}>
        Pixel comparison
      </Text>
      {summary.visualDiffAnalyzed ? (
        <>
          <StatRow
            label="This page"
            value={
              currentPageVisualDiff === null
                ? '—'
                : currentPageVisualDiff
                  ? 'Differences detected'
                  : 'No visible difference'
            }
          />
          <StatRow
            label="Pages flagged so far"
            value={
              summary.pagesWithVisualDiff.length > 0
                ? summary.pagesWithVisualDiff.join(', ')
                : 'None yet'
            }
          />
        </>
      ) : (
        <StatRow
          label="Visual difference scan"
          value=""
          unavailable="Turn on Highlight differences"
        />
      )}
      <Text type="secondary" className={styles.note}>
        Compares rendered pixels of this preview only; it is not evidence of what the file
        contains or of its authenticity.
      </Text>

      {activePage > pageCount ? (
        <Text type="warning" className={styles.warning}>
          Page {activePage} exceeds document length ({pageCount} pages).
        </Text>
      ) : null}
    </aside>
  )
}
