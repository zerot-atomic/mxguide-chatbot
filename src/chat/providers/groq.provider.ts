import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../../config/env';
import { fetchJson, LlmProvider, LlmRequest, ProviderError } from './llm-provider';

interface GroqResponse {
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
}

/**
 * Groq (API compatible con OpenAI: POST /openai/v1/chat/completions).
 * Docs: https://console.groq.com/docs
 */
@Injectable()
export class GroqProvider implements LlmProvider {
  readonly name = 'groq' as const;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  isConfigured(): boolean {
    return Boolean(this.config.groq.apiKey);
  }

  async generate({ system, history, message }: LlmRequest): Promise<string> {
    const { apiKey, model } = this.config.groq;
    if (!apiKey) throw new ProviderError(this.name, 'sin API key');

    const body: Record<string, unknown> = {
      model,
      messages: [
        { role: 'system', content: system },
        ...history.map((turn) => ({ role: turn.role, content: turn.content })),
        { role: 'user', content: message },
      ],
      max_completion_tokens: this.config.maxOutputTokens,
    };
    // Los modelos gpt-oss razonan; para un chat de viaje basta esfuerzo bajo (más rápido).
    if (model.startsWith('openai/gpt-oss')) body.reasoning_effort = 'low';

    const data = (await fetchJson(
      this.name,
      'https://api.groq.com/openai/v1/chat/completions',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
      },
      this.config.providerTimeoutMs,
    )) as GroqResponse;

    return GroqProvider.extractText(data);
  }

  static extractText(data: GroqResponse): string {
    const text = (data.choices?.[0]?.message?.content ?? '').trim();
    if (!text) throw new ProviderError('groq', 'respuesta vacía');
    return text;
  }
}
