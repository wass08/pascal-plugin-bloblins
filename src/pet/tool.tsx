'use client'

import { type AnyNode, type AnyNodeId, useScene } from '@pascal-app/core'
import { EDITOR_LAYER, triggerSFX } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useMemo } from 'react'
import { PetNode } from '../schema'
import { usePets } from '../store'
import { usePlacement } from './placement'
import PetPreview from './preview'

/**
 * The egg placement tool. Mounted by the host's registry-first ToolManager
 * whenever `tool === 'pets:pet'`. Commits an egg carrying the panel builder's
 * draft genome; the sim hatches it EGG_HATCH_MS after `bornAt`.
 */
export default function PetTool() {
  const activeLevelId = useViewer((s) => s.selection.levelId)
  const draftGenome = usePets((s) => s.draftGenome)

  const previewNode = useMemo(
    () =>
      PetNode.parse({
        genome: draftGenome,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
      }),
    [draftGenome],
  )

  const { cursorRef, cursorVisible } = usePlacement(
    activeLevelId,
    (position) => {
      if (!activeLevelId) return
      const now = Date.now()
      const egg = PetNode.parse({
        genome: usePets.getState().draftGenome,
        position,
        rotation: [0, 0, 0],
        bornAt: now,
        lastSimAt: now,
      })
      useScene.getState().createNode(egg as unknown as AnyNode, activeLevelId as AnyNodeId)
      useViewer.getState().setSelection({ selectedIds: [egg.id as AnyNodeId] })
      triggerSFX('sfx:item-place')
    },
    previewNode,
  )

  if (!activeLevelId) return null

  return (
    <group layers={EDITOR_LAYER} ref={cursorRef} visible={cursorVisible}>
      <PetPreview node={previewNode} />
    </group>
  )
}
