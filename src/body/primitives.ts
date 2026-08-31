import {
  BoxGeometry,
  type BufferGeometry,
  CapsuleGeometry,
  ConeGeometry,
  SphereGeometry,
  TorusGeometry,
} from 'three'
import type { BodyPart } from './body-spec'

/**
 * One unit primitive per part kind, shared by every pet, egg and dropping in
 * the scene — parts are meshes scaled off these, so a houseful of pets
 * allocates no geometry at all. Units match the `body-spec.ts` contract:
 * sphere radius 1, capsule r=1 l=1, cone r=1 h=1, box 1³, torus radius 1 with
 * a 0.3 tube.
 */
export const UNIT_SPHERE = new SphereGeometry(1, 20, 14)
export const UNIT_CAPSULE = new CapsuleGeometry(1, 1, 6, 12)
export const UNIT_CONE = new ConeGeometry(1, 1, 16)
export const UNIT_BOX = new BoxGeometry(1, 1, 1)
export const UNIT_TORUS = new TorusGeometry(1, 0.3, 10, 20)

export function geometryFor(kind: BodyPart['kind']): BufferGeometry {
  switch (kind) {
    case 'capsule':
      return UNIT_CAPSULE
    case 'cone':
      return UNIT_CONE
    case 'box':
      return UNIT_BOX
    case 'torus':
      return UNIT_TORUS
    default:
      return UNIT_SPHERE
  }
}

/** Decorative meshes opt out of picking so they never eat the cursor ray. */
export const NO_RAYCAST = () => null
