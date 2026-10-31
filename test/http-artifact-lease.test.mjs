import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import { PassThrough } from 'node:stream'
import { syncBuiltinESMExports } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../src/app.mjs'
import { serve } from '../src/http.mjs'

function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

async function within(promise) {
  let timer
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('HTTP lease gate timed out')), 5000)
    })])
  } finally { clearTimeout(timer) }
}

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'ivoraige-http-lease-'))
  const app = await createApp({ store: join(dir, 'synthetic.sqlite') })
  t.after(async () => { await app.dispose(); await rm(dir, { recursive: true, force: true }) })
  const { document } = await app.records.importDocument({ format: 'txt', content: 'Synthetic artifact.' },
    { sourceId: 'http-lease', language: 'en' })
  const exported = await app.exporter.exportDocument(document.id, { contentMode: 'source', outputs: [{ format: 'md' }] })
  return { app, document, item: exported.artifacts[0] }
}

async function serverWithDisconnect(t, app) {
  const original = http.createServer
  const disconnected = deferred()
  http.createServer = handler => original((req, res) => {
    res.once('close', () => disconnected.resolve())
    return handler(req, res)
  })
  syncBuiltinESMExports()
  try {
    const server = await serve(app, { port: 0, mcp: false })
    t.after(async () => server.close())
    return { server, disconnected }
  } finally {
    http.createServer = original
    syncBuiltinESMExports()
  }
}

function request(url) {
  const client = http.request(url)
  client.on('error', () => {})
  client.end()
  return client
}

test('HTTP disconnect during artifact acquisition or stat releases the late read lease once', async t => {
  for (const stage of ['artifact', 'stat']) {
    await t.test(stage, async t => {
      const { app, document, item } = await fixture(t)
      const entered = deferred(), resume = deferred(), released = deferred()
      const originalArtifact = app.operations.artifact.bind(app.operations)
      const originalStat = fs.promises.stat
      let releases = 0, opens = 0
      const retain = app.records.retainArtifact.bind(app.records)
      app.records.retainArtifact = (...args) => {
        const release = retain(...args)
        return () => { releases++; release(); released.resolve() }
      }
      if (stage === 'artifact') app.operations.artifact = async (...args) => {
        const result = await originalArtifact(...args)
        entered.resolve()
        await resume.promise
        return result
      }
      else fs.promises.stat = async (...args) => {
        if (args[0] === item.path) { entered.resolve(); await resume.promise }
        return originalStat(...args)
      }
      const originalStream = fs.createReadStream
      fs.createReadStream = (...args) => { opens++; return originalStream(...args) }
      syncBuiltinESMExports()
      try {
        const { server, disconnected } = await serverWithDisconnect(t, app)
        const client = request(`${server.url}/api/artifacts/${item.id}/download`)
        await within(entered.promise)
        client.destroy()
        await within(disconnected.promise)
        resume.resolve()
        await within(released.promise)
        assert.equal(releases, 1)
        assert.equal(opens, 0, 'closed response must not open a stream')
        assert.equal(app.records.artifactLeases.get(item.id), undefined)
        assert.equal((await app.operations.invoke('deleteArtifact', { docId: document.id, artifactId: item.id })).recordDeleted, true)
      } finally {
        resume.resolve()
        fs.promises.stat = originalStat
        fs.createReadStream = originalStream
        syncBuiltinESMExports()
      }
    })
  }
})

test('HTTP disconnect while stream opens releases lease; stat/open failure and normal response also release once', async t => {
  for (const stage of ['disconnect', 'stat-failure', 'open-failure', 'normal']) {
    await t.test(stage, async t => {
      const { app, document, item } = await fixture(t)
      const entered = deferred(), disconnected = deferred(), released = deferred()
      const originalStream = fs.createReadStream
      const originalStat = fs.promises.stat
      let stream, releases = 0
      const retain = app.records.retainArtifact.bind(app.records)
      app.records.retainArtifact = (...args) => {
        const release = retain(...args)
        return () => { releases++; release(); released.resolve() }
      }
      if (stage === 'stat-failure') {
        fs.promises.stat = async (...args) => {
          if (args[0] === item.path) throw Object.assign(new Error('synthetic missing file'), { code: 'ENOENT' })
          return originalStat(...args)
        }
        syncBuiltinESMExports()
      } else if (stage !== 'normal') {
        fs.createReadStream = () => { stream = new PassThrough(); entered.resolve(); return stream }
        syncBuiltinESMExports()
      }
      try {
        const server = await serve(app, { port: 0, mcp: false })
        t.after(async () => server.close())
        if (stage === 'normal' || stage === 'stat-failure') {
          const response = await fetch(`${server.url}/api/artifacts/${item.id}/download`)
          assert.equal(response.status, stage === 'normal' ? 200 : 404)
          if (stage === 'normal') assert.match(await response.text(), /Synthetic artifact\./)
          else await response.arrayBuffer()
        } else {
          const client = request(`${server.url}/api/artifacts/${item.id}/download`)
          client.once('close', () => disconnected.resolve())
          await within(entered.promise)
          if (stage === 'disconnect') { client.destroy(); await within(disconnected.promise) }
          else stream.destroy(Object.assign(new Error('synthetic missing file'), { code: 'ENOENT' }))
        }
        await within(released.promise)
        assert.equal(releases, 1)
        assert.equal(app.records.artifactLeases.get(item.id), undefined)
        assert.equal((await app.operations.invoke('deleteArtifact', { docId: document.id, artifactId: item.id })).recordDeleted, true)
      } finally {
        stream?.destroy()
        fs.createReadStream = originalStream
        fs.promises.stat = originalStat
        syncBuiltinESMExports()
      }
    })
  }
})
