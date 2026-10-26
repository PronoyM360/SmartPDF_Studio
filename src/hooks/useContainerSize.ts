import { useEffect, useState, type RefObject } from 'react'

export interface ContainerSize {
  width: number
  height: number
}

export function useContainerSize(
  targetRef: RefObject<HTMLElement | null>,
): ContainerSize {
  const [size, setSize] = useState<ContainerSize>({ width: 0, height: 0 })

  useEffect(() => {
    const element = targetRef.current
    if (!element) {
      return
    }

    const update = (): void => {
      const rect = element.getBoundingClientRect()
      setSize({
        width: Math.floor(rect.width),
        height: Math.floor(rect.height),
      })
    }

    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [targetRef])

  return size
}
