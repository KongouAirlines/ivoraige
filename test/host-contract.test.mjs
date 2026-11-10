import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { Duplex } from 'node:stream'
import Ajv2020 from 'ajv/dist/2020.js'
import { createHostSession } from '../src/host-session.mjs'
import { dispatchHostAction, formatHostFailure } from '../src/host-transport.mjs'

const base = new URL('../docs/requirements/0.1.x/', import.meta.url)
const schema = JSON.parse(await readFile(new URL('schemas/host-control-v1.schema.json', base), 'utf8'))
const { cases } = JSON.parse(await readFile(new URL('fixtures/host-control-v1.cases.json', base), 'utf8'))
const ajv = new Ajv2020({ allErrors: true, strict: false })
ajv.addSchema(schema)

test('HostControl design fixtures validate under the checked-in Draft 2020-12 schema', () => {
  const ids = new Set()
  for (const { id, definition, valid, instance } of cases) {
    assert.ok(!ids.has(id), `duplicate fixture: ${id}`)
    ids.add(id)
    const validate = ajv.getSchema(`${schema.$id}#/$defs/${definition}`)
    assert.ok(validate, `unknown definition: ${definition}`)
    assert.equal(validate(instance), valid, `${id}: ${ajv.errorsText(validate.errors)}`)
    if (valid && definition === 'Attached') {
      assert.equal(instance.generation, instance.state.generation, `${id}: generation mismatch`)
      assert.equal(instance.dataDomainRef, instance.state.dataDomainRef, `${id}: domain mismatch`)
    }
  }
  assert.ok(cases.length >= 100, 'fixture coverage unexpectedly dropped')
})

test('actual unavailable session errors preserve the declared code/reason mapping', () => {
  const validate = ajv.getSchema(`${schema.$id}#/$defs/OwnerIPCFrame`)
  for (const cause of ['revoked', 'released', 'ephemeral']) {
    let held = true
    const session = createHostSession({ dataDomainRef: 'domain', generation: 'generation',
      origin: 'http://127.0.0.1:4321', lifetime: cause === 'ephemeral' ? 'ephemeral' : 'resident',
      isOwnerHeld: () => held })
    const credential = cause === 'ephemeral' ? 'x'.repeat(43) : session.issueBootstrap().credential
    if (cause === 'revoked') session.revokeAll()
    if (cause === 'released') held = false
    for (const invoke of [() => session.issueBootstrap(), () => session.exchange({
      credential, requestOrigin: session.origin, host: '127.0.0.1:4321' })]) {
      assert.throws(invoke, error => {
        const frame = formatHostFailure(error)
        assert.equal(validate(frame), true, `${cause}: ${ajv.errorsText(validate.errors)}`)
        assert.equal(frame.error.code, cause === 'ephemeral' ? 'CONFLICT' : 'PRECONDITION_FAILED')
        assert.equal(frame.error.details.reason, cause === 'ephemeral' ? 'temporary-owner' : 'owner-unavailable')
        return true
      })
    }
  }
})

test('ownerBootstrap dispatch emits a schema-valid failure for a revoked session', async () => {
  const session = createHostSession({ dataDomainRef: 'domain', generation: 'generation',
    lifetime: 'resident', origin: 'http://127.0.0.1:4321' })
  session.revokeAll()
  let reply = ''
  const socket = new Duplex({ read() {}, write(chunk, _encoding, callback) { reply += chunk; callback() } })
  try {
    await dispatchHostAction(socket, { interfaceVersion: 'HostControl@1', minor: 0,
      requestId: 'session-contract', expectedGeneration: 'generation', action: 'ownerBootstrap',
      params: {}, capability: 'synthetic-unit-test-capability' }, {
      dataDomainRef: 'domain', generation: 'generation', capability: 'synthetic-unit-test-capability',
      getState: () => ({ dataDomainRef: 'domain', generation: 'generation', storeOwnership: 'held' }),
      getSession: () => session,
    })
    const frame = JSON.parse(reply)
    const validate = ajv.getSchema(`${schema.$id}#/$defs/OwnerIPCFrame`)
    assert.equal(validate(frame), true, ajv.errorsText(validate.errors))
    assert.equal(frame.error.code, 'PRECONDITION_FAILED')
    assert.equal(frame.error.details.reason, 'owner-unavailable')
  } finally { socket.destroy() }
})
