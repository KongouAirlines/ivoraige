import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../src/app.mjs'
import { serve } from '../src/http.mjs'
import { createStateSync } from '../src/state-sync.mjs'

function gate() {
  let resolve, reject
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail })
  return { promise, resolve, reject }
}

test('actual HTTP subscription and helper refetch a commit during snapshot response without a later event',
  { timeout: 10000 }, async t => {
    const dir = await mkdtemp(join(tmpdir(), 'ivoraige-v03-http-'))
    const app = await createApp({ store: join(dir, 'store.sqlite') })
    const server = await serve(app, { port: 0 })
    const firstResponse = gate(), releaseResponse = gate(), synchronized = gate()
    const snapshots = [], requests = [], readyResponses = [], connections = []
    let sync
    t.after(async () => {
      releaseResponse.resolve()
      sync?.stop()
      await server.close()
      await app.dispose()
      await rm(dir, { recursive: true, force: true })
    })
    sync = createStateSync({
      retryMs: 0,
      connect({ onReady, onNotice, onDisconnect }) {
        const controller = new AbortController()
        const connection = (async () => {
          try {
            const response = await fetch(server.url + '/api/events/state', { signal: controller.signal })
            assert.equal(response.status, 200)
            const reader = response.body.getReader()
            const decoder = new TextDecoder()
            let buffer = ''
            for (;;) {
              const chunk = await reader.read()
              if (chunk.done) break
              buffer += decoder.decode(chunk.value, { stream: true })
              let boundary
              while ((boundary = buffer.indexOf('\n\n')) >= 0) {
                const frame = buffer.slice(0, boundary)
                buffer = buffer.slice(boundary + 2)
                const lines = frame.split('\n')
                const type = lines.find(line => line.startsWith('event: '))?.slice(7)
                const data = lines.find(line => line.startsWith('data: '))
                if (!data) continue
                const value = JSON.parse(data.slice(6))
                if (type === 'state.ready') { readyResponses.push(value); onReady(value) }
                else onNotice(value)
              }
            }
            if (!controller.signal.aborted) onDisconnect()
          } catch (error) {
            if (!controller.signal.aborted) {
              firstResponse.reject(error)
              synchronized.reject(error)
              onDisconnect()
            }
          }
        })()
        connections.push(connection)
        return () => controller.abort()
      },
      async snapshot(ready, { signal }) {
        const response = await fetch(server.url + '/api/state?subscriptionId=' +
          encodeURIComponent(ready.subscriptionId), { signal, cache: 'no-store' })
        assert.equal(response.status, 200)
        const value = await response.json()
        requests.push(ready.subscriptionId)
        if (requests.length === 1) {
          firstResponse.resolve(value)
          await releaseResponse.promise
        }
        return value
      },
      onState(value) { snapshots.push(value) },
      onStatus(status) {
        if (status === 'synchronized' && snapshots.at(-1)?.state.documents.length) synchronized.resolve()
      },
    })

    const first = await firstResponse.promise
    assert.equal(first.state.documents.length, 0)
    // The server has already captured and acknowledged the first snapshot.
    // Its response is held at the client while a real durable write commits.
    const imported = await app.records.importDocument({ format: 'txt',
      content: 'Synthetic V03 actual HTTP source.' }, { language: 'en' })
    releaseResponse.resolve()
    await synchronized.promise

    assert.equal(readyResponses.length, 1)
    assert.equal(requests.length, 2)
    assert.equal(new Set(requests).size, 1)
    assert.equal(new Set(snapshots.map(value => value.subscriptionId)).size, 1)
    assert.equal(snapshots[0].subscriptionId, readyResponses[0].subscriptionId)
    assert.equal(snapshots[0].stateRevision, readyResponses[0].barrierRevision)
    assert.deepEqual(snapshots.map(value => value.stateRevision),
      [readyResponses[0].barrierRevision, readyResponses[0].barrierRevision + 1])
    assert.equal(snapshots.at(-1).state.documents[0].id, imported.document.id)
    assert.doesNotMatch(JSON.stringify(snapshots.at(-1).state), /Synthetic V03 actual HTTP source/)
    assert.equal(sync.status, 'synchronized')

    sync.stop()
    await server.close()
    await Promise.all(connections)
    assert.equal(app.events.sessions.size, 0)
    t.diagnostic(JSON.stringify({ readyCount: readyResponses.length, reads: requests.length,
      barrier: readyResponses[0].barrierRevision, revisions: snapshots.map(value => value.stateRevision),
      sameSubscription: new Set(requests).size === 1, closedSessions: app.events.sessions.size }))
  })
