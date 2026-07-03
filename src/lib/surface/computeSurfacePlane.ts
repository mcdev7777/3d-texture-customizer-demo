import type { BufferGeometry, Vector3 } from 'three'
import type { SurfacePlaneData } from '../../types/pattern'
import {
  createSurfaceProjectionFromHighlight,
  surfacePlaneFromProjection,
} from '../geometry/surfaceProjection'

/**
 * Compute the oriented plane (center, normal, in-plane size, orientation) for a
 * selected surface from its world-space highlight geometry and seed normal.
 *
 * Delegates to the shared surface projection so Preview Texture and Apply Texture
 * use one consistent coordinate frame.
 */
export function computeSurfacePlaneFromHighlight(
  highlightGeometry: BufferGeometry,
  worldNormal: Vector3,
  fallbackCenter?: Vector3,
): SurfacePlaneData {
  const projection = createSurfaceProjectionFromHighlight(
    highlightGeometry,
    worldNormal,
    fallbackCenter,
  )
  return surfacePlaneFromProjection(projection)
}
