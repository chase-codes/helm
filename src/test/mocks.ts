import { waitFor } from '@testing-library/react'
import { expect } from 'vitest'

// Structural, so both `vi.fn()` and `ReturnType<typeof vi.fn>` stubs fit.
type Clearable = { mockClear(): unknown }

// Wait for a mock's mount/initial call to land, THEN clear it. Gate on the mock
// itself, never on sibling DOM: a passive effect (React's useEffect) can commit
// after the DOM a `findByText` gate resolved on, so a `mockClear()` placed behind
// a DOM gate can clear zero calls and let the in-flight effect land right after —
// turning a `not.toHaveBeenCalled()` assertion into a flake.
//
// With `expectedArgs`, waits for a call with exactly those args (pass
// `expect.anything()` for payloads you don't care about); without, any call.
export async function settleAndClear(fn: Clearable,...expectedArgs: unknown[]): Promise<void> {
  await waitFor(() => {
    if (expectedArgs.length) expect(fn).toHaveBeenCalledWith(...expectedArgs)
    else expect(fn).toHaveBeenCalled()
  })
  fn.mockClear()
}
