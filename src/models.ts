import type { LanguageModel } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'

// resolveModel("provider:model-id") -> LanguageModel.
// Split on the FIRST colon only: ollama model ids legitimately contain colons
// (e.g. "llama3:8b"), so provider = before the first colon, model id = the rest.
// Providers construct without touching the network or reading a key here — a
// missing key only fails later, at the actual call. We never log the spec's
// value beyond the provider name, and never touch API keys directly.
export function resolveModel(spec: string): LanguageModel {
  const idx = spec.indexOf(':')
  if (idx < 1 || idx === spec.length - 1) {
    throw new Error(`invalid model spec ${JSON.stringify(spec)}: expected "provider:model-id"`)
  }
  const provider = spec.slice(0, idx)
  const modelId = spec.slice(idx + 1)

  switch (provider) {
    case 'anthropic':
      // Reads ANTHROPIC_API_KEY from env by default.
      return createAnthropic()(modelId)
    case 'openai':
      return createOpenAICompatible({
        name: 'openai',
        baseURL: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
        apiKey: process.env.OPENAI_API_KEY,
      })(modelId)
    case 'ollama':
      // openai-compatible endpoint; Ollama ignores the key but the header is harmless.
      return createOpenAICompatible({
        name: 'ollama',
        baseURL: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434/v1',
        apiKey: process.env.OLLAMA_API_KEY ?? 'ollama',
      })(modelId)
    case 'openrouter':
      // OpenAI-compatible gateway to many models. Model ids carry a slash
      // (e.g. "anthropic/claude-3.5-sonnet", "google/gemini-flash-1.5:free");
      // splitting on the first colon keeps the whole id intact.
      return createOpenAICompatible({
        name: 'openrouter',
        baseURL: process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
        apiKey: process.env.OPENROUTER_API_KEY,
      })(modelId)
    default:
      throw new Error(`unknown provider ${JSON.stringify(provider)}: expected anthropic|openai|ollama|openrouter`)
  }
}
