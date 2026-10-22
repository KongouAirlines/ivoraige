import { satisfies } from 'semver'
import packageInfo from '../package.json' with { type: 'json' }

export const SUPPORTED_NODE_RANGE = packageInfo.engines.node

export function assertSupportedNode(version = process.versions.node) {
  if (!satisfies(version, SUPPORTED_NODE_RANGE)) {
    const error = new Error(`Unsupported Node.js ${version}; ivoraige requires ${SUPPORTED_NODE_RANGE}. Install a supported security release before starting ivoraige.`)
    error.code = 'ERR_UNSUPPORTED_NODE_VERSION'
    throw error
  }
}

// Check before the application loads DSH, opens storage, or makes requests.
assertSupportedNode()
