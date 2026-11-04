import type { ModelOption } from '../shared/types.js';

// Curated, OpenAI-compatible chat models. Anything reachable through the
// configured OPENAI_BASE_URL works; the free/open-source entries assume a
// local OpenAI-compatible server (Ollama, LM Studio, llama.cpp, vLLM).
export const MODEL_CATALOG: ModelOption[] = [
  {
    id: 'gpt-4o-mini',
    label: 'GPT-4o mini',
    description: 'Fast and inexpensive. A good default for everyday work.',
    provider: 'OpenAI-compatible',
  },
  {
    id: 'gpt-4o',
    label: 'GPT-4o',
    description: 'Stronger reasoning and writing at a higher cost.',
    provider: 'OpenAI-compatible',
  },
  {
    id: 'gpt-4.1-mini',
    label: 'GPT-4.1 mini',
    description: 'Balanced general-purpose model with a large context window.',
    provider: 'OpenAI-compatible',
  },
  {
    id: 'gpt-4.1',
    label: 'GPT-4.1',
    description: 'High-quality reasoning for complex, multi-step tasks.',
    provider: 'OpenAI-compatible',
  },
  {
    id: 'o4-mini',
    label: 'o4-mini',
    description: 'Reasoning-focused model for careful analysis.',
    provider: 'OpenAI-compatible',
  },
  {
    id: 'llama3.1:8b',
    label: 'Llama 3.1 8B (local)',
    description: 'Free and open source. Serve locally with Ollama.',
    provider: 'Local · Ollama',
  },
  {
    id: 'qwen2.5:7b',
    label: 'Qwen 2.5 7B (local)',
    description: 'Free and open source. Serve locally with Ollama.',
    provider: 'Local · Ollama',
  },
  {
    id: 'mistral-nemo',
    label: 'Mistral Nemo (local)',
    description: 'Free and open source. Serve locally with Ollama.',
    provider: 'Local · Ollama',
  },
];

export function isKnownModel(id: string): boolean {
  return MODEL_CATALOG.some((model) => model.id === id);
}

export interface ResolvedModel {
  id: string;
  source: 'default' | 'dot';
}

// A Dot's own model wins when set; otherwise the deployment default applies.
export function resolveModel(
  dotModelId: string | null | undefined,
  defaultModel: string | undefined,
): ResolvedModel | undefined {
  const dotModel = dotModelId?.trim();
  if (dotModel) return { id: dotModel, source: 'dot' };
  const fallback = defaultModel?.trim();
  return fallback ? { id: fallback, source: 'default' } : undefined;
}
