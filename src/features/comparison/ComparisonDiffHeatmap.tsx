import { useEffect, useRef } from 'react'
import styles from './ComparisonDiffHeatmap.module.css'

interface ComparisonDiffHeatmapProps {
  heatmap: ImageData
  sourceWidth: number
  sourceHeight: number
  displayWidth: number
  displayHeight: number
}

export function ComparisonDiffHeatmap({
  heatmap,
  sourceWidth,
  sourceHeight,
  displayWidth,
  displayHeight,
}: ComparisonDiffHeatmapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }
    canvas.width = sourceWidth
    canvas.height = sourceHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      return
    }
    ctx.putImageData(heatmap, 0, 0)
  }, [heatmap, sourceWidth, sourceHeight])

  return (
    <canvas
      ref={canvasRef}
      className={styles.heatmap}
      style={{ width: displayWidth, height: displayHeight }}
      aria-hidden
    />
  )
}
