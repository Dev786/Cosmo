import type { LLMProvider, ChatRequest, ChatResponse } from '../types';
import { RetryableError, AuthError } from '../types';
import { getApiKey } from '../../../core/secrets';

export const anthropicProvider: LLMProvider = {
  name: 'anthropic',
  capabilities: { nativeWebSearch: false, offline: false },

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const apiKey = getApiKey('anthropic', 'ANTHROPIC_API_KEY');
    if (!apiKey) throw new AuthError('Check your ANTHROPIC_API_KEY');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: req.model ?? 'claude-haiku-4-5-20251001',
          max_tokens: req.maxTokens ?? 1024,
          system: req.system,
          messages: req.messages.map(m => ({ role: m.role, content: m.content })),
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);
      if (res.status === 401) throw new AuthError('Check your ANTHROPIC_API_KEY');
      if (res.status === 429 || res.status >= 500) throw new RetryableError(`Anthropic returned ${res.status}`);

      const data = await res.json() as { content?: Array<{ text?: string }>; error?: { message?: string } };
      if (data.error) throw new Error(data.error.message ?? 'Anthropic API error');
      return { text: data.content?.[0]?.text ?? '' };
    } finally {
      clearTimeout(timeout);
    }
  },

  async listModels(): Promise<string[]> {
    const apiKey = getApiKey('anthropic', 'ANTHROPIC_API_KEY');
    if (!apiKey) return [];
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const res = await fetch('https://api.anthropic.com/v1/models?limit=100', {
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        signal: controller.signal,
      });
      if (res.status === 401) throw new AuthError('Check your ANTHROPIC_API_KEY');
      if (!res.ok) throw new Error(`Anthropic models returned ${res.status}`);
      const data = await res.json() as { data?: Array<{ id?: string }> };
      return (data.data ?? []).map(m => m.id).filter((id): id is string => !!id);
    } finally {
      clearTimeout(timeout);
    }
  },
};
