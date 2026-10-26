export type OcrConfidenceTier = 'high' | 'medium' | 'low'

export function ocrConfidenceTier(confidence: number): OcrConfidenceTier {
  if (confidence >= 85) {
    return 'high'
  }
  if (confidence >= 60) {
    return 'medium'
  }
  return 'low'
}

export function ocrConfidenceLabel(confidence: number): string {
  const tier = ocrConfidenceTier(confidence)
  const rounded = Math.round(confidence)
  switch (tier) {
    case 'high':
      return `Estimate · ${rounded}% (likely)`
    case 'medium':
      return `Estimate · ${rounded}% (review)`
    default:
      return `Estimate · ${rounded}% (uncertain)`
  }
}
