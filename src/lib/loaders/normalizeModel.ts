import { Box3, Group, Vector3 } from 'three'
import type { Object3D } from 'three'
import { computeModelStats } from './modelStats'
import type { ModelStats } from '../../types/model'

const TARGET_SIZE = 4

export interface NormalizedModel {
  object: Object3D
  stats: ModelStats
}

export function normalizeModel(object: Object3D): NormalizedModel {
  object.updateMatrixWorld(true)

  const box = new Box3().setFromObject(object)
  const center = box.getCenter(new Vector3())
  const size = box.getSize(new Vector3())
  const maxDim = Math.max(size.x, size.y, size.z, 0.001)

  const wrapper = new Group()
  object.position.sub(center)
  object.updateMatrixWorld(true)
  wrapper.add(object)

  const scale = TARGET_SIZE / maxDim
  wrapper.scale.setScalar(scale)
  wrapper.updateMatrixWorld(true)

  const stats = computeModelStats(wrapper)

  return { object: wrapper, stats }
}
