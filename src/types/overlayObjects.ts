import type { ImageOverlayObject } from './imageOverlay'
import type { MaskOverlayObject } from './maskOverlay'
import type { TextOverlayObject } from './textOverlay'

export type OverlayObject =
  | TextOverlayObject
  | ImageOverlayObject
  | MaskOverlayObject

export type OverlayKind = OverlayObject['kind']

export function isTextOverlay(object: OverlayObject): object is TextOverlayObject {
  return object.kind === 'text'
}

export function isImageOverlay(object: OverlayObject): object is ImageOverlayObject {
  return object.kind === 'image'
}

export function isMaskOverlay(object: OverlayObject): object is MaskOverlayObject {
  return object.kind === 'mask'
}

const KIND_LAYER_ORDER: Record<OverlayKind, number> = {
  mask: 0,
  image: 1,
  text: 2,
}

export function compareOverlayLayerOrder(a: OverlayObject, b: OverlayObject): number {
  const kindDelta = KIND_LAYER_ORDER[a.kind] - KIND_LAYER_ORDER[b.kind]
  if (kindDelta !== 0) {
    return kindDelta
  }
  return a.createdAt - b.createdAt
}
