import { useEffect, useMemo, useRef } from 'react'
import { Label, Layer, Rect, Stage, Tag, Text } from 'react-konva'
import { useDocumentSections } from '@/features/sections/DocumentSectionsContext'
import { usePageViewport } from '@/features/text-tools/usePageViewport'
import { createPageDisplayTransform, pdfRectToScreenBounds } from '@/lib/pdf'
import { getSectionCategory } from '@/lib/sections/sectionCategories'
import styles from './SectionHighlightLayer.module.css'

interface SectionHighlightLayerProps {
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

/** Non-interactive outlines for detected sections; recomputed from PDF bounds at every zoom/rotation. */
export function SectionHighlightLayer({
  pageNumber,
  pageIndex,
  renderScale,
}: SectionHighlightLayerProps) {
  const viewport = usePageViewport(pageNumber, renderScale)
  const {
    sections,
    selectedIds,
    activeSectionId,
    outlinesVisible,
    focusNonce,
    labelFor,
  } = useDocumentSections()
  const activeAnchorRef = useRef<HTMLDivElement>(null)
  const handledNonceRef = useRef(0)

  const pageTransform = useMemo(
    () => (viewport ? createPageDisplayTransform(pageIndex, viewport) : null),
    [pageIndex, viewport],
  )

  const pageSections = useMemo(
    () => sections.filter((section) => section.pageIndex === pageIndex),
    [sections, pageIndex],
  )

  const active = pageSections.find((section) => section.id === activeSectionId) ?? null
  const activeScreen =
    active && pageTransform ? pdfRectToScreenBounds(pageTransform, active.bounds) : null

  useEffect(() => {
    if (!activeScreen || handledNonceRef.current === focusNonce) {
      return
    }
    handledNonceRef.current = focusNonce
    activeAnchorRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
      inline: 'nearest',
    })
  }, [activeScreen, focusNonce])

  if (!viewport || !pageTransform || pageSections.length === 0) {
    return null
  }

  const visible = pageSections.filter(
    (section) =>
      outlinesVisible || selectedIds.has(section.id) || section.id === activeSectionId,
  )

  return (
    <div
      className={styles.host}
      style={{ width: viewport.width, height: viewport.height }}
      aria-hidden
    >
      {activeScreen ? (
        <div
          ref={activeAnchorRef}
          className={styles.anchor}
          style={{
            left: activeScreen.x,
            top: activeScreen.y,
            width: activeScreen.width,
            height: activeScreen.height,
          }}
        />
      ) : null}
      <Stage width={viewport.width} height={viewport.height} listening={false}>
        <Layer listening={false}>
          {visible.map((section) => {
            const screen = pdfRectToScreenBounds(pageTransform, section.bounds)
            const color = getSectionCategory(section.category).color
            const isActive = section.id === activeSectionId
            const isSelected = selectedIds.has(section.id)
            const uncertain = section.ambiguous || section.confidence === 'low'
            return (
              <Rect
                key={section.id}
                x={screen.x}
                y={screen.y}
                width={screen.width}
                height={screen.height}
                cornerRadius={2}
                fill={
                  isActive
                    ? withAlpha(color, 0.18)
                    : isSelected
                      ? withAlpha(color, 0.12)
                      : undefined
                }
                stroke={isActive || isSelected ? color : withAlpha(color, 0.55)}
                strokeWidth={isActive ? 2.5 : isSelected ? 1.5 : 1}
                dash={uncertain || !isSelected ? [6, 4] : undefined}
              />
            )
          })}
          {active && activeScreen ? (
            <Label
              x={activeScreen.x}
              y={Math.max(0, activeScreen.y - 20)}
            >
              <Tag fill={getSectionCategory(active.category).color} cornerRadius={3} />
              <Text
                text={labelFor(active)}
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
