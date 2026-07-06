import { Box3, Group, Vector3 } from 'three'
import type { Object3D } from 'three'
import { computeModelStats } from './modelStats'
import type { ModelStats } from '../../types/model'

const TARGET_SIZE = 4

export interface NormalizedModel {
  object: Object3D
  stats: ModelStats
  /** Multiply viewer-space coordinates to restore source millimeter dimensions. */
  exportUnitScale: number
}

export function normalizeModel(object: Object3D): NormalizedModel {
  object.updateMatrixWorld(true)

  const box = new Box3().setFromObject(object)
  const center = box.getCenter(new Vector3())
  const size = box.getSize(new Vector3())
  const maxDim = Math.max(size.x, size.y, size.z, 0.001)

  // Center on X/Y and sit the bottom on the build plate (z = 0).
  object.position.x -= center.x
  object.position.y -= center.y
  object.position.z -= box.min.z
  object.updateMatrixWorld(true)

  const wrapper = new Group()
  wrapper.add(object)

  const scale = TARGET_SIZE / maxDim
  wrapper.scale.setScalar(scale)
  wrapper.updateMatrixWorld(true)

  const exportUnitScale = maxDim / TARGET_SIZE
  wrapper.userData.exportUnitScale = exportUnitScale

  const stats = computeModelStats(wrapper)

  return { object: wrapper, stats, exportUnitScale }
}
