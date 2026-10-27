import { useEffect, useMemo, useRef } from 'react'
import { Label, Layer, Rect, Stage, Tag, Text } from 'react-konva'
import { usePageViewport } from '@/features/text-tools/usePageViewport'
import { createPageDisplayTransform, pdfRectToScreenBounds } from '@/lib/pdf'
import { PRICE_ROLE_COLORS, PRICE_ROLE_LABELS } from '@/lib/prices/priceLabels'
import { usePriceEditor } from './PriceEditorContext'
import styles from './PriceHighlightLayer.module.css'

interface PriceHighlightLayerProps {
  pageNumber: number
  pageIndex: number
  renderScale: number
}

function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace('#', '')
  const r = Number.parseInt(value.slice(0, 2), 16)
  const g = Number.parseInt(value.slice(2, 4), 16)
  const b = Number.parseInt(value.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** Editor-only outlines for detected amounts; never drawn into the exported PDF. */
export function PriceHighlightLayer({ pageNumber, pageIndex, renderScale }: PriceHighlightLayerProps) {
  const viewport = usePageViewport(pageNumber, renderScale)
  const { candidates, selectedId, highlightsVisible, panelActive, committedEdits, focusNonce } =
    usePriceEditor()
  const anchorRef = useRef<HTMLDivElement>(null)
  const handledNonceRef = useRef(0)

  const transform = useMemo(
    () => (viewport ? createPageDisplayTransform(pageIndex, viewport) : null),
    [pageIndex, viewport],
  )
  const pageCandidates = useMemo(
    () => candidates.filter((candidate) => candidate.pageIndex === pageIndex),
    [candidates, pageIndex],
  )
  const selected = pageCandidates.find((candidate) => candidate.id === selectedId) ?? null
  const selectedScreen = selected && transform ? pdfRectToScreenBounds(transform, selected.bounds) : null

  useEffect(() => {
    if (!selectedScreen || handledNonceRef.current === focusNonce) {
      return
    }
    handledNonceRef.current = focusNonce
    anchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
  }, [selectedScreen, focusNonce])

  if (!viewport || !transform || pageCandidates.length === 0) {
    return null
  }
  const showAll = panelActive && highlightsVisible
  const visible = pageCandidates.filter((candidate) => showAll || candidate.id === selectedId)
  if (visible.length === 0) {
    return null
  }

  return (
    <div className={styles.host} style={{ width: viewport.width, height: viewport.height }} aria-hidden>
      {selectedScreen ? (
        <div
          ref={anchorRef}
          className={styles.anchor}
          style={{
            left: selectedScreen.x,
            top: selectedScreen.y,
            width: selectedScreen.width,
            height: selectedScreen.height,
          }}
        />
      ) : null}
      <Stage width={viewport.width} height={viewport.height} listening={false}>
        <Layer listening={false}>
          {visible.map((candidate) => {
            const screen = pdfRectToScreenBounds(transform, candidate.bounds)
            const color = PRICE_ROLE_COLORS[candidate.role]
            const isSelected = candidate.id === selectedId
            const edited = committedEdits.has(candidate.id)
            const pad = isSelected ? 3 : 1.5
            return (
              <Rect
                key={candidate.id}
                x={screen.x - pad}
                y={screen.y - pad}
                width={screen.width + pad * 2}
                height={screen.height + pad * 2}
                cornerRadius={2}
                fill={isSelected ? withAlpha(color, 0.16) : undefined}
                stroke={edited ? '#0f766e' : color}
                strokeWidth={isSelected ? 2.5 : 1}
                dash={candidate.source === 'ocr' || candidate.confidence === 'low' ? [5, 3] : edited ? [2, 2] : undefined}
                opacity={isSelected ? 1 : 0.8}
              />
            )
          })}
          {selected && selectedScreen ? (
            <Label x={selectedScreen.x} y={Math.max(0, selectedScreen.y - 22)}>
              <Tag fill={PRICE_ROLE_COLORS[selected.role]} cornerRadius={3} />
              <Text
                text={`${selected.label ?? PRICE_ROLE_LABELS[selected.role]} · ${selected.text}`}
                fontSize={11}
                fontStyle="bold"
                padding={4}
                fill="#ffffff"
              />
            </Label>
          ) : null}
        </Layer>
      </Stage>
    </div>
  )
}
