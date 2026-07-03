import {
  Group,
  Mesh,
  type Object3D,
} from 'three'

/**
 * Clone a model tree for export. Every mesh geometry is deep-cloned so the
 * live scene is never mutated. Preview/helper objects are kept but the
 * export pipeline filters them out via userData flags.
 */
function cloneModelForExport(originalModel: Object3D): Object3D {
  const clone = originalModel.clone(true)
  clone.traverse((child) => {
    if ('isMesh' in child && child.isMesh) {
      const mesh = child as Mesh
      if (mesh.geometry) {
        mesh.geometry = mesh.geometry.clone()
      }
      mesh.userData.exportable = true
    }
  })
  return clone
}

/**
 * Build an exportable object from the model. With in-place baking the model
 * geometry is already modified, so this simply deep-clones it.
 */
export function buildExportableModifiedObject(
  originalModel: Object3D,
): Object3D {
  const group = new Group()
  group.name = 'ModifiedExportRoot'
  group.userData.exportable = true
  group.add(cloneModelForExport(originalModel))
  return group
}
