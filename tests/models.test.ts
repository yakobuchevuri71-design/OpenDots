import { describe, expect, it } from 'vitest';
import {
  MODEL_CATALOG,
  isKnownModel,
  resolveModel,
} from '../src/server/models.js';

describe('model selection', () => {
  it('offers free local models alongside OpenAI-compatible ones', () => {
    expect(
      MODEL_CATALOG.some((model) => model.provider.startsWith('Local')),
    ).toBe(true);
    expect(MODEL_CATALOG.every((model) => model.id && model.label)).toBe(true);
    expect(isKnownModel('gpt-4o-mini')).toBe(true);
    expect(isKnownModel('not-a-model')).toBe(false);
  });

  it('prefers a Dot model and falls back to the deployment default', () => {
    expect(resolveModel('llama3.1:8b', 'gpt-4o-mini')).toEqual({
      id: 'llama3.1:8b',
      source: 'dot',
    });
    expect(resolveModel(null, 'gpt-4o-mini')).toEqual({
      id: 'gpt-4o-mini',
      source: 'default',
    });
    expect(resolveModel('', '')).toBeUndefined();
    expect(resolveModel(null, undefined)).toBeUndefined();
  });
});
