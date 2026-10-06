import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'

// Suggestions only: saving uses DSH settings and credentials; this is not a
// second model registry. Built-in protocols/capabilities come from pinned pi-ai.
function catalogPreset(provider, label, credentialRef, preferredModel) {
  const catalog = getBuiltinModels(provider)
  const model = catalog.find(item => item.id === preferredModel) ?? catalog[0]
  if (!model) return null
  return { id: provider, label, defaults: { provider, model: model.id,
    credentialRef, timeoutMs: 120_000 },
    models: catalog.map(item => ({ id: item.id, name: item.name, api: item.api, baseURL: item.baseUrl })),
    note: '协议和端点留空时继承各模型的目录默认。候选来自软件固定版本；请核对账号可用性。未收录模型请使用不同的自定义提供商标识，并填写端点、协议及容量。' }
}

const localPreset = (id, label, baseURL, model) => ({ id, label,
  defaults: { provider: id, model, api: 'openai-completions', baseURL,
    credentialRef: `${id.toUpperCase().replaceAll('-', '_')}_LOCAL_KEY`,
    contextWindow: 8192, maxTokens: 2048, timeoutMs: 120_000 },
  models: [], placeholderCredential: 'local',
  note: '请填写本机已加载的模型 ID，并按服务实际配置修改容量。无密钥的本地服务也需保存非秘密占位凭据 local，以满足当前模型 SDK；需要认证的服务请填写真实密钥。' })

export const modelPresets = [
  catalogPreset('deepseek', 'DeepSeek', 'DEEPSEEK_API_KEY', 'deepseek-flash'),
  catalogPreset('anthropic', 'Anthropic', 'ANTHROPIC_API_KEY', 'claude-haiku-4-5'),
  catalogPreset('openrouter', 'OpenRouter', 'OPENROUTER_API_KEY', 'qwen/qwen3-32b'),
  catalogPreset('moonshotai-cn', 'Kimi / Moonshot（国内）', 'MOONSHOT_API_KEY', 'kimi-k2.6'),
  catalogPreset('moonshotai', 'Kimi / Moonshot（国际）', 'MOONSHOT_API_KEY', 'kimi-k2.6'),
  catalogPreset('openai', 'OpenAI', 'OPENAI_API_KEY', 'gpt-4.1-mini'),
  { id: 'siliconflow', label: '硅基流动', defaults: { provider: 'siliconflow', model: '',
    api: 'openai-completions', baseURL: 'https://api.siliconflow.cn/v1',
    credentialRef: 'SILICONFLOW_API_KEY', contextWindow: 8192, maxTokens: 2048, timeoutMs: 120_000 },
    models: [], note: '从硅基流动模型广场填写完整模型 ID，容量按该模型实际规格修改；不假设所有账号都能使用同一模型。' },
  localPreset('ollama', 'Ollama（本地，可运行 Llama 等模型）', 'http://127.0.0.1:11434/v1', 'llama3.2'),
  localPreset('llama-cpp', 'llama.cpp（本地）', 'http://127.0.0.1:8080/v1', ''),
  localPreset('lmstudio', 'LM Studio（本地）', 'http://127.0.0.1:1234/v1', ''),
].filter(Boolean)
