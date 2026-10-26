import { Typography } from 'antd'
import type { ComparisonChangeSummary } from '@/features/comparison/buildComparisonChangeSummary'
import styles from './ComparisonChangeSummaryPanel.module.css'

const { Text } = Typography

interface ComparisonChangeSummaryPanelProps {
  summary: ComparisonChangeSummary
  activePage: number
  pageCount: number
  currentPageVisualDiff: boolean | null
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
}: ComparisonChangeSummaryPanelProps) {
  const pagesLabel =
    summary.pagesWithOverlays.length > 0
      ? summary.pagesWithOverlays.join(', ')
      : 'None'

  return (
    <aside className={styles.panel} aria-label="Change summary">
      <Text strong className={styles.title}>
        Detected changes
      </Text>
      <Text type="secondary" className={styles.note}>
        Counts reflect overlay objects in the editor, not native PDF text stream
        edits.
      </Text>

      <StatRow label="Text overlays added" value={summary.textAdded} />
      <StatRow label="Text overlays updated" value={summary.textUpdated} />
      <StatRow label="Images added" value={summary.imagesAdded} />
      <StatRow label="Images updated" value={summary.imagesUpdated} />
      <StatRow label="Masks added" value={summary.masksAdded} />
      <StatRow label="Masks updated" value={summary.masksUpdated} />
      <StatRow
        label="Move / resize / content updates"
        value={summary.geometryOrContentUpdates}
      />
      <StatRow
        label="Native PDF text changes"
        value=""
        unavailable="Not analyzed (overlay-only comparison)"
      />

      <div className={styles.divider} />

      <StatRow label="Pages with overlays" value={pagesLabel} />

      {summary.visualDiffAnalyzed ? (
        <>
          <StatRow
            label="Pages with visual diff (current view)"
            value={
              currentPageVisualDiff === null
                ? '—'
                : currentPageVisualDiff
                  ? 'Differences detected'
                  : 'No meaningful diff'
            }
          />
          <StatRow
            label="Pages flagged (session)"
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
          unavailable="Enable highlight to analyze this page"
        />
      )}

      {activePage > pageCount ? (
        <Text type="warning" className={styles.warning}>
          Page {activePage} exceeds document length ({pageCount} pages).
        </Text>
      ) : null}
    </aside>
  )
}
