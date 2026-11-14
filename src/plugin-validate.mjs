// Internal child process. The installer holds the profile lease until exit.
import { bootProfile } from './model-settings.mjs'
import { AppBoot, FiberState } from '../dist/dsh.mjs'
const { directory, storePath, ids } = JSON.parse(process.argv[2])
const { acquireProbe } = await import('./plugin-profile.mjs')
const probe = await acquireProbe(directory)
let app
try {
  app = await bootProfile({ directory, storePath })
  await AppBoot.reconcileProfilePatches(app.ctx,
    AppBoot.readProfilePatches('dsh', app.ctx.get('profileContext')), 'dsh', ids)
  // Native auditing skips disabled entries and does not reject absent IDs.
  // Installation succeeds only when every declared contribution is active.
  for (const id of ids) {
    const entries = [...app.ctx.loader.entries()].filter(entry => entry.options.id === id)
    if (entries.length !== 1 || entries[0].disabled || entries[0].fiber?.state !== FiberState.ACTIVE)
      throw new Error(`Plugin contribution is absent, disabled or inactive: ${id}`)
  }
} finally { await app?.dispose(); probe.release() }
