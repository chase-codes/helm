import type { VerbKind } from './transport'

export type PreVerbId = 'startLoop' | 'stopLoop' | 'showCard'

export interface PreVerb {
  id: PreVerbId
  label: string
  enabled: boolean
  /** Read only for the primary slot (`primaryBtnStyle`); the secondary verb is
   * content-sized and styled by `secondaryVerbStyle(T, enabled)`. */
  kind: VerbKind
  title: string
}

export interface PreVerbInput {
  /** The engine's loop flag (`PreState.engaged`). */
  engaged: boolean
  /** The selected card is in the preview but not on the audience screen. */
  armed: boolean
  hasCards: boolean
}

export interface PreVerbs {
  primary: PreVerb
  secondary: PreVerb
}

// Stop loop halts the rotation and leaves the card lit (preserviceEngine.ts `disengage`
// makes no presentation call), so it is the `neutral` look: enabled, not green, not red.
function loopVerb({ engaged, hasCards }: PreVerbInput): PreVerb {
  if (engaged) {
    return {
      id: 'stopLoop',
      label: 'Stop loop',
      enabled: true,
      kind: 'neutral',
      title: 'Hold the card that is up now. The screen stays on; Take down clears it.'
    }
  }
  return hasCards
    ? {
        id: 'startLoop',
        label: 'Start loop',
        enabled: true,
        kind: 'go',
        title: 'Put the loop on the audience screen and rotate through the cards'
      }
    : {
        id: 'startLoop',
        label: 'Start loop',
        enabled: false,
        kind: 'ghost',
        title: 'Nothing to loop yet: add a card first'
      }
}

function showVerb({ armed, hasCards }: PreVerbInput): PreVerb {
  if (armed) {
    return {
      id: 'showCard',
      label: 'Show this card',
      enabled: true,
      kind: 'go',
      title: 'Put this card on the audience screen now, with no rotation'
    }
  }
  return {
    id: 'showCard',
    label: 'Show this card',
    enabled: false,
    kind: 'ghost',
    title: hasCards ? 'This card is already on screen' : 'Nothing to show yet: add a card first'
  }
}

/**
 * Which pre-service verb owns the green, right-most transport slot, and which sits left
 * of the spacer. Chase's decision 4 lives here and nowhere else: the row (PreServiceMode)
 * and Enter both read `primary`, so swapping `showVerb` and `loopVerb` below swaps the page.
 *
 * Show this card owns the slot because it only ever puts something on screen, so the
 * green slot keeps rule 2's meaning with no exception. The loop toggle sits left of the
 * spacer, where Stop loop (which puts nothing up) can't be mistaken for a go verb.
 */
export function preVerbs(s: PreVerbInput): PreVerbs {
  return { primary: showVerb(s), secondary: loopVerb(s) }
}

export function runPreVerb(id: PreVerbId): void {
  if (id === 'startLoop') window.helm.preservice.engage()
  else if (id === 'stopLoop') window.helm.preservice.disengage()
  else window.helm.preservice.showNow()
}
