import { registerTools } from './mcp-tools.mjs'
const tools = {
  settings_get: ['getSettings', 'Read model configuration and credential status, without credential values.'],
  settings_update: ['updateSettings', 'Update model settings with existing optimistic lock fields.'],
  credential_set: ['setCredential', 'Store a named model credential through DSH; only supply a user-authorized credential.'],
}


export const inject = ['ivoraige.mcp', 'ivoraige.operations', 'ivoraige.modelSettings']
export function apply(ctx) { registerTools(ctx, tools) }
