import { useEffect, useMemo, useState } from 'react'
import type { TextReplacementPlan } from '@/lib/pdf/buildTextReplacementPlan'

export type TextReplacementStyleOverrides = Partial<
  Pick<
    TextReplacementPlan,
    'fontFamily' | 'fontSize' | 'fontWeight' | 'color' | 'maskFillColor' | 'maskOpacity'
  >
>

export function useTextReplacementPlanOverrides(
  basePlan: TextReplacementPlan | null,
  resetKey: string | null,
): {
  plan: TextReplacementPlan | null
  overrides: TextReplacementStyleOverrides
  patchOverrides: (patch: TextReplacementStyleOverrides) => void
} {
  const [overrides, setOverrides] = useState<TextReplacementStyleOverrides>({})

  useEffect(() => {
    setOverrides({})
  }, [resetKey])

  const plan = useMemo(() => {
    if (!basePlan) {
      return null
    }
    return { ...basePlan, ...overrides }
  }, [basePlan, overrides])

  const patchOverrides = (patch: TextReplacementStyleOverrides): void => {
    setOverrides((prev) => ({ ...prev, ...patch }))
  }

  return { plan, overrides, patchOverrides }
}
