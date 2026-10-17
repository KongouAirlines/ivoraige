import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('built Node bundle carries complete notices for its bundled dependencies', async () => {
  const content = await readFile(new URL('../dist/THIRD_PARTY_LICENSES.txt', import.meta.url), 'utf8')
  const sections = content.trim().split(/\n\n=+\n\n/)
  for (const section of sections) {
    const [heading, ...body] = section.split('\n')
    assert.ok(body.join('\n').trim(), `Missing bundled license notice: ${heading}`)
  }
  for (const [name, copyright] of [
    ['@earendil-works/pi-ai 0.87.1', 'Copyright (c) 2025 Mario Zechner'],
    ['data-uri-to-buffer 4.0.1', 'Copyright (c) 2014 Nathan Rajlich'],
    ['standardwebhooks 1.1.1', 'Copyright (c) 2023 Svix'],
  ]) {
    const section = sections.find(value => value.startsWith(`${name} (`))
    assert.ok(section, `Missing bundled dependency: ${name}`)
    assert.match(section, /Permission is hereby granted/)
    assert.ok(section.includes(copyright), `Missing applicable copyright: ${name}`)
  }
})
