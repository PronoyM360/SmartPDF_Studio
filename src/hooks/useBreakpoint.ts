import { useEffect, useState } from 'react'

export type LayoutMode = 'desktop' | 'tablet' | 'mobile'

const QUERIES: { mode: LayoutMode; query: string }[] = [
  { mode: 'mobile', query: '(max-width: 767px)' },
  { mode: 'tablet', query: '(min-width: 768px) and (max-width: 1023px)' },
  { mode: 'desktop', query: '(min-width: 1024px)' },
]

function readLayoutMode(): LayoutMode {
  if (typeof window === 'undefined') {
    return 'desktop'
  }
  for (const { mode, query } of QUERIES) {
    if (window.matchMedia(query).matches) {
      return mode
    }
  }
  return 'desktop'
}

export function useBreakpoint(): LayoutMode {
  const [mode, setMode] = useState<LayoutMode>(() => readLayoutMode())

  useEffect(() => {
    const mediaLists = QUERIES.map(({ query }) => window.matchMedia(query))
    const sync = (): void => setMode(readLayoutMode())

    for (const list of mediaLists) {
      list.addEventListener('change', sync)
    }
    sync()

    return () => {
      for (const list of mediaLists) {
        list.removeEventListener('change', sync)
      }
    }
  }, [])

  return mode
}
