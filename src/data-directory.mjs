import { join } from 'node:path'
import { homedir } from 'node:os'

export function defaultDataDirectory() {
  return process.env.IVORAIGE_DATA_DIR ?? join(process.platform === 'win32'
    ? process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local')
    : process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'ivoraige')
}
