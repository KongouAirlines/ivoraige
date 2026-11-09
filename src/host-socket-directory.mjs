import { createHash } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'

// Unix socket paths have a small OS byte limit. Keep the endpoint under a
// bounded private directory, independent of long home/registry paths. The
// registry remains the authority; this deterministic name is never a secret.
export async function hostSocketDirectory(registryDirectory) {
  const namespace = createHash('sha256').update(`${process.getuid()}:${resolve(registryDirectory)}`).digest('hex').slice(0, 20)
  return join(await realpath('/tmp'), `ivoraige-${namespace}`)
}
