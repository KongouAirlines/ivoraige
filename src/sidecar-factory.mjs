import { Service } from '../dist/dsh.mjs'
import { SidecarClient } from './sidecar.mjs'

// Host-owned protocol transport for independently installed Python adapters.
// The caller owns and closes each returned client before its source is removed.
export class SidecarFactory extends Service {
  constructor(ctx) { super(ctx, 'ivoraige.sidecarFactory') }
  create(config) { return new SidecarClient(config) }
}
