import { verifiedRecommendation } from './verified-recommendation';
import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { APP_CONFIG, AppConfig, ProviderName } from '../config/env';
import { CatalogContext, PlaceSummary, PlacesService } from '../places/places.service';
import { normalize } from '../places/state-resolver';
import { ChatRequestDto } from './dto/chat-request.dto';
import { LLM_PROVIDERS, LlmProvider, LlmRequest } from './providers/llm-provider';
import { buildSuggestions, buildSystemPrompt } from './prompt';

export interface ChatResponse {
  reply: string;
  /** Proveedor que respondió; en avisos locales, proveedor seleccionado sin invocarlo. */
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

    const context = await this.places.getContext(dto.location, dto.message, dto.history);
    const { places } = context;
    const nearby = context.mode === 'nearby' && context.status === 'found';
    const notice = ChatService.catalogNotice(context);
    if (notice) return { reply: notice, provider: providers[0].name, places: [], suggestions: buildSuggestions(false) };
    const request: LlmRequest = {
      system: buildSystemPrompt({ places, userName: dto.userName, hasLocation: nearby, stateName: context.state?.name, intent: context.intent }),
      history: (dto.history ?? []).slice(-12),
      message: dto.message.trim(),
    };

    const { text, provider } =
      this.config.strategy === 'race' ? await this.race(providers, request) : await this.fallback(providers, request);

    const verified = verifiedRecommendation(text, context);
    return {
      ...verified,
      provider,
      suggestions: buildSuggestions(nearby),
    };
  }

  private static catalogNotice(context: CatalogContext): string | undefined {
    switch (context.status) {
      case 'categories-unavailable': return 'El catálogo recibido no permite confirmar las categorías para esta búsqueda. Puedes indicar un estado o explorar lugares variados; no puedo asegurar este filtro de cercanía con los datos disponibles.';
      case 'intent-ambiguous': return '¿Qué tipo de lugares prefieres: atractivos turísticos, hospedaje o gastronomía? Tu solicitud combina tipos o exclusiones que necesito aclarar.';
      case 'found': return undefined;
      case 'empty': return `La consulta${context.state ? ` de ${context.state.name}` : ''} no devolvió coincidencias confirmadas para el tipo solicitado entre los registros recibidos de MXGuide. ¿Quieres buscar otro destino?`;
      case 'ambiguous': return '¿Qué estado quieres consultar? Mencionaste varios destinos o una exclusión; prefiero confirmar antes de recomendarte lugares.';
      case 'unrecognized': return '¿Puedes escribir el nombre completo del estado tal como aparece en MXGuide? Si te refieres a México, aclara si buscas Ciudad de México, Estado de México o destinos del país.';
      case 'missing-location': return 'Comparte tu ubicación para buscar lugares cerca de ti, o dime qué estado quieres visitar.';
      default: return 'No pude consultar el catálogo de MXGuide en este momento. Intenta de nuevo en un rato; no puedo confirmar destinos registrados ahora.';
    }
  }

  private async fallback(providers: LlmProvider[], request: LlmRequest) {
    for (const provider of providers) {
      try {
        return { text: await provider.generate(request), provider: provider.name };
      } catch {
        this.logger.warn(`Falló ${provider.name}, probando el siguiente.`);
      }
    }
    throw this.unavailable();
  }

  private async race(providers: LlmProvider[], request: LlmRequest) {
    try {
      return await Promise.any(
        providers.map(async (provider) => ({ text: await provider.generate(request), provider: provider.name })),
      );
    } catch {
      this.logger.warn('Fallaron todos los proveedores.');
      throw this.unavailable();
    }
  }

  private unavailable() {
    return new ServiceUnavailableException('Balam no está disponible en este momento. Intenta de nuevo en un rato.');
  }

  /** Lugares del catálogo cuyo nombre aparece en la respuesta (máximo 5). */
  static mentionedPlaces(reply: string, places: PlaceSummary[]): PlaceSummary[] {
    const text = ` ${normalize(reply)} `;
    return places.filter((p) => {
      const name = normalize(p.name);
      return name.length >= 3 && places.filter(q => normalize(q.name) === name).length === 1
        && !places.some(q => q.id !== p.id && normalize(q.name).includes(name))
        && text.includes(` ${name} `);
    }).slice(0, 5);
  }
}
