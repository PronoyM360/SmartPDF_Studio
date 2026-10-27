import { useEffect, useState } from 'react'

/** Loads an image URL for Konva; returns null until it has decoded. */
export function useHtmlImage(url: string | null | undefined): HTMLImageElement | null {
  const [loaded, setLoaded] = useState<{ url: string; image: HTMLImageElement } | null>(null)

  useEffect(() => {
    if (!url) {
      return
    }
    let active = true
    const image = new Image()
    image.onload = () => {
      if (active) {
        setLoaded({ url, image })
      }
    }
    image.src = url
    return () => {
      active = false
      image.onload = null
    }
  }, [url])

  return url && loaded?.url === url ? loaded.image : null
}
