import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const bundle = process.env.IVORAIGE_RUNTIME_PROBE_BUNDLE || 'dist/dsh.mjs'
const { Context, Service } = await import(pathToFileURL(resolve(bundle)).href)

const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

test('isolation does not inherit a parent fiber injection across a derived context', async () => {
  const root = new Context()
  root.provide('ivoraige.rc11.isolated', { identity: 'outer' })
  const seen = []
  const read = ctx => {
    try { return ctx['ivoraige.rc11.isolated'].identity }
    catch (error) { return error.message }
  }
  try {
    await root.inject(['ivoraige.rc11.isolated'], async ctx => {
      await ctx.plugin(child => { seen.push(read(child)) })
      await ctx.isolate('ivoraige.rc11.isolated').plugin(child => { seen.push(read(child)) })
      await ctx.isolate('ivoraige.rc11.isolated',
        ctx[Context.isolate]['ivoraige.rc11.isolated']).plugin(child => { seen.push(read(child)) })
    })
    assert.equal(seen[0], 'outer')
    assert.match(seen[1], /without inject/)
    assert.match(seen[2], /without inject/)
  } finally {
    await root.fiber.dispose()
  }
})

test('same service name in independent hosts does not leak or withdraw the other host', async () => {
  class Probe extends Service {
    constructor(ctx, config) {
      super(ctx, 'ivoraige.rc11.probe')
      this.identity = config.identity
    }
  }
  const left = new Context()
  const right = new Context()
  try {
    await left.plugin(Probe, { identity: 'left' })
    await right.plugin(Probe, { identity: 'right' })
    assert.equal(left.get('ivoraige.rc11.probe')?.identity, 'left')
    assert.equal(right.get('ivoraige.rc11.probe')?.identity, 'right')
    await left.fiber.dispose()
    assert.equal(left.get('ivoraige.rc11.probe'), undefined)
    assert.equal(right.get('ivoraige.rc11.probe')?.identity, 'right')
  } finally {
    await left.fiber.dispose()
    await right.fiber.dispose()
  }
  assert.equal(right.get('ivoraige.rc11.probe'), undefined)
})

test('disposal while service init is pending drains it after init settles', { timeout: 10_000 }, async () => {
  const entered = deferred()
  const release = deferred()
  const events = []
  class Pending extends Service {
    constructor(ctx) {
      super(ctx, 'ivoraige.rc11.pending')
      ctx.effect(() => () => { events.push('effect disposed') })
    }
    async [Service.init]() {
      entered.resolve()
      await release.promise
      events.push('init settled')
    }
  }
  const ctx = new Context()
  try {
    const mounted = ctx.plugin(Pending)
    await entered.promise
    const closing = ctx.fiber.dispose()
    release.resolve()
    await Promise.all([mounted, closing])
    assert.deepEqual(events, ['init settled', 'effect disposed'])
    assert.equal(ctx.get('ivoraige.rc11.pending'), undefined)
  } finally {
    release.resolve()
    await ctx.fiber.dispose()
  }
})

test('failed service init can be disposed and its name mounted again', async () => {
  const failure = new Error('expected init failure')
  const ctx = new Context()
  class Failed extends Service {
    constructor(ctx) { super(ctx, 'ivoraige.rc11.reusable') }
    [Service.init]() { throw failure }
  }
  class Working extends Service {
    constructor(ctx) { super(ctx, 'ivoraige.rc11.reusable') }
  }
  try {
    const failed = ctx.plugin(Failed)
    await assert.rejects(async () => { await failed }, error => error === failure)
    assert.equal(failed.state, 3, 'the failed fiber should enter FAILED')
    await failed.dispose()
    assert.equal(failed.state, 4, 'a disposed failed fiber should enter DISPOSED')
    await ctx.plugin(Working)
    assert.ok(ctx.get('ivoraige.rc11.reusable') instanceof Working)
  } finally {
    await ctx.fiber.dispose()
  }
  assert.equal(ctx.get('ivoraige.rc11.reusable'), undefined)
})

test('disposing an unsatisfied injected fiber settles PENDING to DISPOSED', async () => {
  const ctx = new Context()
  try {
    const pending = ctx.inject(['ivoraige.rc11.neverProvided'], () => {})
    assert.equal(pending.state, 0, 'the missing dependency should leave the fiber PENDING')
    await pending.dispose()
    assert.equal(pending.state, 4, 'a disposed pending fiber should enter DISPOSED')
  } finally {
    await ctx.fiber.dispose()
  }
})

test('effect setup can request disposal and still run its cleanup once', async () => {
  const ctx = new Context()
  const events = []
  try {
    const fiber = ctx.plugin(child => {
      child.effect(() => {
        events.push('setup')
        child.fiber.dispose().then(() => events.push('disposed'))
        return () => { events.push('cleanup') }
      })
    })
    await fiber
    await fiber.dispose()
    await Promise.resolve()
    assert.deepEqual(events, ['setup', 'cleanup', 'disposed'])
    assert.equal(fiber.state, 4)
  } finally {
    await ctx.fiber.dispose()
  }
})

test('repeated disposal joins asynchronous cleanup and rejects a new unloading effect', async () => {
  const ctx = new Context()
  const entered = deferred()
  const release = deferred()
  const events = []
  try {
    const fiber = ctx.plugin(child => {
      child.effect(() => async () => {
        events.push('cleanup started')
        assert.throws(() => child.effect(() => { events.push('late effect') }), /inactive context/)
        entered.resolve()
        await release.promise
        events.push('cleanup ended')
      })
    })
    await fiber
    const first = fiber.dispose()
    await entered.promise
    const second = fiber.dispose()
    assert.equal(fiber.state, 5, 'cleanup in progress should expose UNLOADING')
    release.resolve()
    await Promise.all([first, second])
    assert.deepEqual(events, ['cleanup started', 'cleanup ended'])
    assert.equal(fiber.state, 4)
  } finally {
    release.resolve()
    await ctx.fiber.dispose()
  }
})

test('disposing an earlier logger exporter does not remove a later exporter', async () => {
  const ctx = new Context()
  const older = [], later = []
  try {
    const first = ctx.plugin(child => {
      child.logger.exporter({ export: message => older.push(message.args[0]) })
    })
    await first
    const second = ctx.plugin(child => {
      child.logger.exporter({ export: message => later.push(message.args[0]) })
    })
    await second
    await first.dispose()
    ctx.logger('ivoraige.rc11.probe').info('after first disposal')
    assert.deepEqual(older, [])
    assert.deepEqual(later, ['after first disposal'])
  } finally {
    await ctx.fiber.dispose()
  }
})

test('internal/plugin can declare a dependency before plugin activation', { timeout: 10_000 }, async () => {
  const ctx = new Context()
  ctx.provide('ivoraige.rc11.lateInject', { identity: 'provided' })
  const off = ctx.on('internal/plugin', fiber => { fiber.inject['ivoraige.rc11.lateInject'] = {} })
  let seen
  try {
    await ctx.plugin(child => { seen = child['ivoraige.rc11.lateInject'].identity })
    assert.equal(seen, 'provided')
  } finally {
    off()
    await ctx.fiber.dispose()
  }
})

test('reentrant internal/plugin disposal prevents its plugin callback from running', { timeout: 10_000 }, async () => {
  const ctx = new Context()
  const off = ctx.on('internal/plugin', fiber => { if (fiber.uid !== null) fiber.dispose() })
  let calls = 0
  try {
    const fiber = ctx.plugin(() => { calls++ })
    await fiber
    assert.equal(calls, 0)
    assert.equal(fiber.state, 4)
  } finally {
    off()
    await ctx.fiber.dispose()
  }
})

test('an internal/plugin disposal observer error cannot starve later observers or cleanup', { timeout: 10_000 }, async () => {
  const ctx = new Context()
  const events = []
  const fiber = ctx.plugin(child => {
    child.effect(() => () => { events.push('cleanup') })
  })
  await fiber
  const throwing = ctx.on('internal/plugin', current => {
    if (current.uid === null) throw new Error('expected observer error')
  })
  const later = ctx.on('internal/plugin', current => {
    if (current.uid === null) events.push('later observer')
  })
  try {
    await fiber.dispose()
    assert.ok(events.includes('later observer'))
    assert.ok(events.includes('cleanup'))
    assert.equal(fiber.state, 4)
  } finally {
    throwing()
    later()
    await ctx.fiber.dispose()
  }
})
