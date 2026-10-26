import type Konva from 'konva'
import { useEffect, useRef, useState } from 'react'
import {
  computeCanvasPixelDiff,
  type PixelDiffResult,
} from '@/features/comparison/computeCanvasPixelDiff'

function compositeEditedCanvas(
  base: HTMLCanvasElement,
  stage: Konva.Stage,
): HTMLCanvasElement | null {
  const composite = document.createElement('canvas')
  composite.width = base.width
  composite.height = base.height
  const ctx = composite.getContext('2d')
  if (!ctx) {
    return null
  }
  ctx.drawImage(base, 0, 0)
  try {
    const overlayCanvas = stage.toCanvas({ pixelRatio: 1 })
    ctx.drawImage(overlayCanvas, 0, 0, composite.width, composite.height)
  } catch {
    return null
  }
  return composite
}

export interface ComparisonVisualDiffState {
  result: PixelDiffResult | null
  analyzing: boolean
}

export function useComparisonVisualDiff(options: {
  enabled: boolean
  pageIndex: number
  baseCanvas: HTMLCanvasElement | null
  editedStage: Konva.Stage | null
  renderGeneration: number
}): ComparisonVisualDiffState {
  const { enabled, pageIndex, baseCanvas, editedStage, renderGeneration } =
    options
  const [result, setResult] = useState<PixelDiffResult | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }

    if (!enabled || !baseCanvas || baseCanvas.width <= 0) {
      setResult(null)
      setAnalyzing(false)
      return
    }

    setAnalyzing(true)
    timerRef.current = window.setTimeout(() => {
      let composite: HTMLCanvasElement | null = baseCanvas
      if (editedStage) {
        composite = compositeEditedCanvas(baseCanvas, editedStage) ?? baseCanvas
      }
      const diff = computeCanvasPixelDiff(baseCanvas, composite)
      setResult(diff)
      setAnalyzing(false)
    }, 120)

    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current)
      }
    }
  }, [
    enabled,
    pageIndex,
    baseCanvas,
    editedStage,
    renderGeneration,
    baseCanvas?.width,
    baseCanvas?.height,
  ])

  return { result, analyzing }
}
