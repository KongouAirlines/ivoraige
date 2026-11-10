import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import Ajv2020 from 'ajv/dist/2020.js'

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
  assert.ok(cases.length >= 95, 'fixture coverage unexpectedly dropped')
})
