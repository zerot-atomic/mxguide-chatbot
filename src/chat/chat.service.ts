import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { APP_CONFIG, AppConfig, ProviderName } from '../config/env';
import { PlaceSummary, PlacesService } from '../places/places.service';
import { ChatRequestDto } from './dto/chat-request.dto';
import { LLM_PROVIDERS, LlmProvider, LlmRequest } from './providers/llm-provider';
import { buildSuggestions, buildSystemPrompt } from './prompt';

export interface ChatResponse {
  reply: string;
  /** Qué agente respondió (útil para depurar; la app no necesita mostrarlo). */
  provider: ProviderName;
  /** Lugares del catálogo que la respuesta menciona: la app los pinta como tarjetas. */
  places: PlaceSummary[];
  suggestions: string[];
}

/**
 * Orquestador de agentes.
 *
 * - fallback: pregunta al proveedor principal; si falla o tarda demasiado,
 *   pregunta al siguiente. Es el modo recomendado (un solo cobro por mensaje).
 * - race: pregunta a todos al mismo tiempo y se queda con la primera respuesta
 *   válida. Responde más rápido, pero se paga a todos los proveedores.
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(LLM_PROVIDERS) private readonly providers: LlmProvider[],
    private readonly places: PlacesService,
  ) {}

  /** Proveedores con llave, el principal primero. */
  activeProviders(): LlmProvider[] {
    return this.providers
      .filter((p) => p.isConfigured())
      .sort((a, b) => Number(b.name === this.config.primaryProvider) - Number(a.name === this.config.primaryProvider));
  }

  async chat(dto: ChatRequestDto): Promise<ChatResponse> {
    const providers = this.activeProviders();
    if (providers.length === 0) {
      throw new ServiceUnavailableException('El asistente no está configurado.');
    }

    const places = await this.places.getContext(dto.location);
    const request: LlmRequest = {
      system: buildSystemPrompt({ places, userName: dto.userName, hasLocation: Boolean(dto.location) }),
      history: (dto.history ?? []).slice(-12),
      message: dto.message.trim(),
    };

    const { text, provider } =
      this.config.strategy === 'race' ? await this.race(providers, request) : await this.fallback(providers, request);

    return {
      reply: text,
      provider,
      places: ChatService.mentionedPlaces(text, places),
      suggestions: buildSuggestions(Boolean(dto.location)),
    };
  }

  private async fallback(providers: LlmProvider[], request: LlmRequest) {
    for (const provider of providers) {
      try {
        return { text: await provider.generate(request), provider: provider.name };
      } catch (error) {
        this.logger.warn(`Falló ${provider.name}, probando el siguiente: ${(error as Error).message}`);
      }
    }
    throw this.unavailable();
  }

  private async race(providers: LlmProvider[], request: LlmRequest) {
    try {
      return await Promise.any(
        providers.map(async (provider) => ({ text: await provider.generate(request), provider: provider.name })),
      );
    } catch (error) {
      const reasons = error instanceof AggregateError ? error.errors.map((e) => (e as Error).message) : [String(error)];
      this.logger.warn(`Fallaron todos los proveedores: ${reasons.join(' | ')}`);
      throw this.unavailable();
    }
  }

  private unavailable() {
    return new ServiceUnavailableException('Balam no está disponible en este momento. Intenta de nuevo en un rato.');
  }

  /** Lugares del catálogo cuyo nombre aparece en la respuesta (máximo 5). */
  static mentionedPlaces(reply: string, places: PlaceSummary[]): PlaceSummary[] {
    const normalize = (s: string) =>
      s
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase();
    const text = normalize(reply);
    return places.filter((p) => p.name.length >= 3 && text.includes(normalize(p.name))).slice(0, 5);
  }
}
