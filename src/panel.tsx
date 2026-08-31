'use client'

import { useScene } from '@pascal-app/core'
import { useEditor } from '@pascal-app/editor'
import { randomGenome } from './genome'
import { patPet } from './interaction'
import { lifeStageOf, type PetNode } from './schema'
import { usePets } from './store'

// STUB — see SPEC.md `panel.tsx`. Final panel: two tabs (My pets roster with
// stat bars / rename / mood, Hatch tab with live 3D genome preview + sliders),
// host UI primitives, empty states.

export default function PetsPanel() {
  const nodes = useScene((s) => s.nodes)
  usePets((s) => s.simTick)
  const pets = Object.values(nodes).filter(
    (n) => (n as { type?: string }).type === 'pets:pet',
  ) as unknown as PetNode[]
  const now = Date.now()

  return (
    <div className="flex flex-col gap-3 p-3 text-sm">
      <div className="flex flex-col gap-2">
        <button
          className="rounded-full bg-primary px-3 py-1.5 text-primary-foreground"
          onClick={() => {
            usePets.getState().setDraftGenome(randomGenome())
            const editor = useEditor.getState()
            editor.setTool('pets:pet')
            editor.setMode('build')
          }}
          type="button"
        >
          Hatch a new egg
        </button>
        <p className="text-muted-foreground text-xs">
          Rolls fresh DNA and arms the egg placement tool.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        {pets.length === 0 && (
          <p className="text-muted-foreground text-xs">No pets yet — place your first egg.</p>
        )}
        {pets.map((pet) => (
          <div
            className="flex items-center justify-between gap-2 rounded-lg border p-2"
            key={pet.id}
          >
            <div className="flex flex-col">
              <span>{pet.name}</span>
              <span className="text-muted-foreground text-xs">
                {lifeStageOf(pet, now)} · fed {Math.round(pet.fullness * 100)}% · happy{' '}
                {Math.round(pet.happiness * 100)}%
              </span>
            </div>
            <button
              className="rounded-full border px-2.5 py-1 text-xs"
              onClick={() => patPet(pet.id)}
              type="button"
            >
              Pat
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
