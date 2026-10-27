import { useEffect, useState } from 'react'

const QUERY = '(prefers-color-scheme: dark)'

function readPrefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) {
    return false
  }
  return window.matchMedia(QUERY).matches
}

export function usePrefersDarkMode(): boolean {
  const [prefersDark, setPrefersDark] = useState(readPrefersDark)

  useEffect(() => {
    const list = window.matchMedia(QUERY)
    const sync = (): void => setPrefersDark(list.matches)
    list.addEventListener('change', sync)
    sync()
    return () => list.removeEventListener('change', sync)
  }, [])

  return prefersDark
}
