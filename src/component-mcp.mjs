import { registerTools } from './mcp-tools.mjs'
const tools = {
  component_status: ['componentStatus', 'Read optional component installation status.'],
  component_catalog: ['componentCatalog', 'Query the configured release catalog anonymously or with a saved token.'],
  component_credential: ['componentCredential', 'Save an optional user-provided GitHub token through DSH.'],
  component_credential_clear: ['componentCredentialClear', 'Remove the saved component GitHub token to allow anonymous access; requires explicit user intent.'],
  component_install: ['componentInstall', 'Download and install the official PDF component; requires explicit user intent. Restart after success.'],
  component_local: ['componentLocal', 'Install the official PDF component from a local manifest path; requires explicit user intent.'],
  component_task: ['componentTask', 'Read a component installation task (separate from document tasks).'],
  component_cancel: ['componentCancel', 'Cancel a component installation task.'],
}


export const inject = ['ivoraige.mcp', 'ivoraige.operations', 'ivoraige.components']
export function apply(ctx) { registerTools(ctx, tools) }
