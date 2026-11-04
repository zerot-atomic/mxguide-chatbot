import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../../config/env';
import { fetchJson, LlmProvider, LlmRequest, ProviderError } from './llm-provider';

interface GrokResponse {
  output_text?: string;
  output?: { type?: string; content?: { type?: string; text?: string }[] }[];
  // Por si se configura un modelo/endpoint con formato de Chat Completions.
  choices?: { message?: { content?: string } }[];
}

/**
 * xAI Grok (Responses API: POST /v1/responses).
 * Docs: https://docs.x.ai/docs/guides/chat
 */
@Injectable()
export class GrokProvider implements LlmProvider {
  readonly name = 'grok' as const;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  isConfigured(): boolean {
    return Boolean(this.config.grok.apiKey);
  }

  async generate({ system, history, message }: LlmRequest): Promise<string> {
    const { apiKey, model } = this.config.grok;
    if (!apiKey) throw new ProviderError(this.name, 'sin API key');

    const body = {
      model,
      input: [
        { role: 'system', content: system },
        ...history.map((turn) => ({ role: turn.role, content: turn.content })),
        { role: 'user', content: message },
      ],
      // No guardamos conversaciones de usuarios en los servidores de xAI.
      store: false,
    };

    const data = (await fetchJson(
      this.name,
      'https://api.x.ai/v1/responses',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
      },
      this.config.providerTimeoutMs,
    )) as GrokResponse;

    return GrokProvider.extractText(data);
  }

  static extractText(data: GrokResponse): string {
    let text = '';
    if (typeof data.output_text === 'string') {
      text = data.output_text;
    } else if (Array.isArray(data.output)) {
      text = data.output
        .filter((item) => item.type === 'message')
        .flatMap((item) => item.content ?? [])
        .filter((part) => part.type === 'output_text' && typeof part.text === 'string')
        .map((part) => part.text)
        .join('');
    } else if (Array.isArray(data.choices)) {
      text = data.choices[0]?.message?.content ?? '';
    }
    text = text.trim();
    if (!text) throw new ProviderError('grok', 'respuesta vacía');
    return text;
  }
}
