import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../../config/env';
import { fetchJson, LlmProvider, LlmRequest, ProviderError } from './llm-provider';

interface GeminiPart {
  text?: string;
  thought?: boolean;
}

interface GeminiResponse {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
}

/**
 * Google Gemini (REST generateContent).
 * Docs: https://ai.google.dev/gemini-api/docs
 */
@Injectable()
export class GeminiProvider implements LlmProvider {
  readonly name = 'gemini' as const;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  isConfigured(): boolean {
    return Boolean(this.config.gemini.apiKey);
  }

  async generate({ system, history, message }: LlmRequest): Promise<string> {
    const { apiKey, model } = this.config.gemini;
    if (!apiKey) throw new ProviderError(this.name, 'sin API key');

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: [
        // Gemini llama "model" a lo que en el resto del mundo es "assistant".
        ...history.map((turn) => ({
          role: turn.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: turn.content }],
        })),
        { role: 'user', parts: [{ text: message }] },
      ],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: this.config.maxOutputTokens,
      },
    };

    const data = (await fetchJson(
      this.name,
      url,
      {
        method: 'POST',
        // La llave va en header (no en la URL) para que no quede en logs.
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(body),
      },
      this.config.providerTimeoutMs,
    )) as GeminiResponse;

    return GeminiProvider.extractText(data);
  }

  static extractText(data: GeminiResponse): string {
    if (data.promptFeedback?.blockReason) {
      throw new ProviderError('gemini', `mensaje bloqueado (${data.promptFeedback.blockReason})`);
    }
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const text = parts
      .filter((part) => !part.thought && typeof part.text === 'string')
      .map((part) => part.text)
      .join('')
      .trim();
    if (!text) throw new ProviderError('gemini', 'respuesta vacía');
    return text;
  }
}
