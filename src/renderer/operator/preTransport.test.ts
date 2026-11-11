// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { preVerbs, runPreVerb, type PreVerbInput } from './preTransport'

const IDLE: PreVerbInput = { engaged: false, armed: true, hasCards: true }

describe('preVerbs (decision 4: Show this card owns the green slot)', () => {
  it('puts Show this card in the green slot and the loop left of the spacer', () => {
    const { primary, secondary } = preVerbs(IDLE)
    expect(primary).toMatchObject({
      id: 'showCard',
      label: 'Show this card',
      enabled: true,
      kind: 'go'
    })
    expect(secondary).toMatchObject({ id: 'startLoop', label: 'Start loop', enabled: true })
  })

  it('the loop verb flips to Stop loop while the loop runs, never in the green look', () => {
    const { secondary } = preVerbs({ ...IDLE, engaged: true })
    expect(secondary).toMatchObject({
      id: 'stopLoop',
      label: 'Stop loop',
      enabled: true,
      kind: 'neutral'
    })
  })

  it('the primary slot ghosts on an empty loop and says why (#88)', () => {
    const { primary, secondary } = preVerbs({ engaged: false, armed: false, hasCards: false })
    expect(primary.enabled).toBe(false)
    expect(primary.kind).toBe('ghost')
    expect(primary.title).toMatch(/add a card/i)
    expect(secondary.enabled).toBe(false)
    expect(secondary.title).toMatch(/add a card/i)
  })

  it('Show this card ghosts once the selected card is already up', () => {
    const { primary } = preVerbs({ ...IDLE, armed: false })
    expect(primary.enabled).toBe(false)
    expect(primary.kind).toBe('ghost')
  })
})

describe('preVerbs invariants (hold under either answer to decision 4)', () => {
  const ALL: PreVerbInput[] = [false, true].flatMap((engaged) =>
    [false, true].flatMap((armed) =>
      [false, true].map((hasCards) => ({ engaged, armed, hasCards }))
    )
  )

  it.each(ALL)('never offers the take-down look in either slot: %o', (s) => {
    const { primary, secondary } = preVerbs(s)
    expect(primary.kind).not.toBe('down')
    expect(secondary.kind).not.toBe('down')
  })

  it.each(ALL)('a disabled primary always wears the ghost: %o', (s) => {
    const { primary } = preVerbs(s)
    if (!primary.enabled) expect(primary.kind).toBe('ghost')
  })

  it.each(ALL)('labels never depend on the card, so the row width is constant: %o', (s) => {
    const { primary, secondary } = preVerbs(s)
    expect(['Start loop', 'Stop loop', 'Show this card']).toContain(primary.label)
    expect(['Start loop', 'Stop loop', 'Show this card']).toContain(secondary.label)
  })
})

describe('runPreVerb', () => {
  afterEach(() => {
    delete (window as unknown as { helm?: unknown }).helm
  })

  it('routes each verb to its one engine call', () => {
    const engage = vi.fn()
    const disengage = vi.fn()
    const showNow = vi.fn()
    ;(window as unknown as { helm: unknown }).helm = { preservice: { engage, disengage, showNow } }

    runPreVerb('startLoop')
    runPreVerb('stopLoop')
    runPreVerb('showCard')
    expect(engage).toHaveBeenCalledTimes(1)
    expect(disengage).toHaveBeenCalledTimes(1)
    expect(showNow).toHaveBeenCalledTimes(1)
  })
})
