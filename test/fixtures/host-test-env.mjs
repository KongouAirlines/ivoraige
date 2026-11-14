// Each test worker has its own protected OS-user registry. Subprocesses started
// by that worker inherit this selection, so cross-process ownership tests still
// share one registry while independent test files cannot contend or leave user
// registrations behind.
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const root = mkdtempSync(join(realpathSync(tmpdir()), 'ivoraige-test-registry-'))
process.env.IVORAIGE_HOST_REGISTRY_ROOT = root
process.on('exit', () => { try { rmSync(root, { recursive: true, force: true }) } catch {} })
