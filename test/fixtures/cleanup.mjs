// Register dependencies before their users. One hook drains every cleanup even
// when a prior cleanup fails; node:test otherwise skips later after hooks.
export function createCleanup(t) {
  const callbacks = []
  t.after(async () => {
    const errors = []
    while (callbacks.length) {
      try { await callbacks.pop()() } catch (error) { errors.push(error) }
    }
    if (errors.length) throw new AggregateError(errors, 'Fixture cleanup failed')
  })
  return callback => callbacks.push(callback)
}
