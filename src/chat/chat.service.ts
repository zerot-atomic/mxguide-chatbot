import { personalizeReply } from './personalization';
import { redactSelectionText, stripPersonalGreeting } from '../common/external-data';
import { ItineraryField, selectionLimit, verifiedRecommendation } from './verified-recommendation';
import { REPLY_FORMAT, ReplyCode, ReplyKind, resolveRecommendationCode } from './response-contract';
import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { APP_CONFIG, AppConfig, ProviderName, logEnabled } from '../config/env';
import { ChatDiagnostic, newRequestId, serializeDiagnostic } from '../common/diagnostics';
import { CatalogContext, PlaceSummary, PlacesService } from '../places/places.service';
import { normalize } from '../places/state-resolver';
import { ChatRequestDto } from './dto/chat-request.dto';
import { LLM_PROVIDERS, LlmProvider, LlmRequest, ProviderError } from './providers/llm-provider';
import { buildConversationPrompt, buildSuggestions, buildSystemPrompt } from './prompt';
import { guardConversationReply } from './conversation-guard';

export interface ChatResponse {
  /** Markdown limitado; ver response-contract.ts. */
  reply: string;
  /** Siempre "markdown" en v2. Flutter debe renderizar reply con un visor Markdown. */
  format: typeof REPLY_FORMAT;
  /** Tipo de respuesta para que la UI decida cómo mostrarla. */
  kind: ReplyKind;
  /** Motivo estable (estado del catálogo o fallback de selección); no es un mensaje para el usuario. */
  code: ReplyCode;
  /** Proveedor que respondió; en avisos locales, proveedor seleccionado sin invocarlo. */
  provider: ProviderName;
  /** Lugares del catálogo que la respuesta menciona: la app los pinta como tarjetas. */
  places: PlaceSummary[];
  suggestions: string[];
  /**
   * Solo en kind "itinerary" con duración reconocida (1–7 días). La concatenación de days[].placeIds es
   * exactamente places.map(p => p.id), en el mismo orden. En cualquier otra respuesta la llave no existe.
   */
  itinerary?: ItineraryField;
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

  /** Punto de entrada: responde y registra una línea de diagnóstico (solo metadatos). */
  async chat(dto: ChatRequestDto): Promise<ChatResponse> {
    const started = Date.now();
    const diag: ChatDiagnostic = {
      requestId: newRequestId(), route: 'notice', catalogStatus: 'pending', candidates: 0, selected: 0, provider: null,
      outcome: 'ok', historyTurns: dto.history?.length ?? 0, hasLocation: Boolean(dto.location), durationMs: 0,
    };
    try {
      const response = await this.respond(dto, diag);
      diag.kind = response.kind;
      diag.code = response.code;
      diag.selected = response.places.length;
      if (response.itinerary) diag.plannedDays = response.itinerary.days.length;
      return response;
    } catch (error) {
      diag.outcome = 'error';
      diag.error = error instanceof Error ? error.constructor.name : 'unknown';
      throw error;
    } finally {
      diag.durationMs = Date.now() - started;
      if (logEnabled(this.config, 'log')) this.logger.log(serializeDiagnostic(diag));
    }
  }

  private async respond(dto: ChatRequestDto, diag: ChatDiagnostic): Promise<ChatResponse> {
    const providers = this.activeProviders();
    if (providers.length === 0) {
      throw new ServiceUnavailableException('El asistente no está configurado.');
    }

    const context = await this.places.getContext(dto.location, dto.message, dto.history);
    const { places } = context;
    Object.assign(diag, {
      catalogStatus: context.status, intent: context.intent, mode: context.status === 'conversation' ? undefined : context.mode,
      stateId: context.state?.id, requestedType: context.requestedType?.key, candidates: places.length,
      itinerary: context.itinerary || undefined, itineraryDays: context.itineraryDays,
    });
    const nearby = context.mode === 'nearby' && context.status === 'found';
    const personalize = (reply: string) => personalizeReply(reply, dto.userName ? redactSelectionText(dto.userName, [this.config.gemini.apiKey, this.config.groq.apiKey, this.config.chatApiKey]) : undefined);
    const secrets = [this.config.gemini.apiKey, this.config.groq.apiKey, this.config.chatApiKey];
    const safe = (text: string) => redactSelectionText(text, secrets);
    if (context.status === 'conversation') {
      diag.route = 'conversation';
      const response = await this.converse(providers, dto, safe, personalize);
      diag.provider = response.provider;
      return response;
    }
    const notice = ChatService.catalogNotice(context);
    if (notice) return { reply: personalize(notice), format: REPLY_FORMAT, kind: 'notice', code: context.status, provider: providers[0].name, places: [], suggestions: buildSuggestions(false) };
    const request: LlmRequest = {
      system: buildSystemPrompt({ places, hasLocation: nearby, intent: context.intent }),
      history: [],
      message: JSON.stringify({ query: safe(dto.message.trim()), intent: context.intent ?? 'general', maxPlaceIds: selectionLimit(context), candidates: places.map(p => ({id:p.id,name:safe(p.name),category:safe(p.category),state:safe(p.state)})) }),
    };

    diag.route = 'catalog';
    const { text, provider } =
      this.config.strategy === 'race' ? await this.race(providers, request) : await this.fallback(providers, request);
    diag.provider = provider;

    const verified = verifiedRecommendation(text, context);
    return {
      reply: personalize(verified.reply),
      format: REPLY_FORMAT,
      kind: verified.kind,
      code: resolveRecommendationCode(verified.places.length, verified.fallback),
      places: verified.places,
      provider,
      suggestions: buildSuggestions(nearby),
      ...(verified.itinerary ? { itinerary: verified.itinerary } : {}),
    };
  }

  /**
   * Conversación general: el modelo escribe libre con historial (como en main), sin catálogo,
   * ubicación ni nombre del usuario. Nunca produce tarjetas.
   */
  private async converse(providers: LlmProvider[], dto: ChatRequestDto, safe: (t: string) => string, personalize: (t: string) => string): Promise<ChatResponse> {
    const request: LlmRequest = {
      system: buildConversationPrompt(),
      history: (dto.history ?? []).slice(-12).map(turn => ({ role: turn.role, content: safe(turn.role === 'assistant' ? stripPersonalGreeting(turn.content) : turn.content).slice(0, 1500) })),
      message: safe(dto.message.trim()),
    };
    const { text, provider } =
      this.config.strategy === 'race' ? await this.race(providers, request) : await this.fallback(providers, request);
    const guarded = guardConversationReply(text);
    return {
      reply: personalize(guarded.reply),
      format: REPLY_FORMAT,
      kind: 'conversation',
      code: guarded.replaced ? 'conversation-guarded' : 'conversation',
      provider,
      places: [],
      suggestions: buildSuggestions(Boolean(dto.location)),
    };
  }

  private static catalogNotice(context: CatalogContext): string | undefined {
    switch (context.status) {
      case 'categories-unavailable': return 'El catálogo recibido no permite confirmar las categorías para esta búsqueda. Puedes indicar un estado o explorar lugares variados; no puedo asegurar este filtro de cercanía con los datos disponibles.';
      case 'intent-ambiguous': return '¿Qué tipo de lugares prefieres: atractivos turísticos, hospedaje o gastronomía? Tu solicitud combina tipos o exclusiones que necesito aclarar.';
      case 'followup-ambiguous': return '¿Cuáles lugares de la respuesta anterior quieres comparar? Puedes repetir sus nombres o indicar el estado para hacer una nueva búsqueda.';
      case 'itinerary-missing-state': return '¿Qué estado te gustaría conocer? Dímelo para preparar un itinerario sencillo con destinos de MXGuide.';
      case 'itinerary-days-out-of-range': return `Puedo preparar itinerarios de 1 a 7 días. ¿Cuántos días quieres para conocer ${context.state ? context.state.name : 'tu destino'}? Responde con un número del 1 al 7.`;
      case 'itinerary-food-unverified': return 'Puedo mostrarte opciones gastronómicas, pero el catálogo no distingue restaurantes de platillos. Para armar paradas visitables necesito esa información confirmada. ¿Prefieres un itinerario de atractivos turísticos?';
      case 'found': return undefined;
      case 'exhausted': return `Ya te mostré los destinos${context.state ? ` de ${context.state.name}` : ''} que encontré en MXGuide para esta búsqueda. ¿Quieres buscar otro tipo de lugar u otro estado?`;
      case 'type-unverified': {
        const label = context.requestedType?.label ?? 'ese tipo de lugar';
        const where = context.state ? ` en ${context.state.name}` : context.mode === 'nearby' ? ' cerca de ti' : '';
        const others = context.state ? ` de ${context.state.name}` : '';
        return `El catálogo de MXGuide no clasifica ${label} como una categoría y no encontré destinos registrados${where} que las mencionen. ¿Quieres que te muestre otros atractivos${others}?`;
      }
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
      } catch (error) {
        if (logEnabled(this.config, 'warn')) this.logger.warn(`Falló ${provider.name} (${ChatService.failureReason(error)}), probando el siguiente.`);
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
      const reasons = error instanceof AggregateError ? error.errors.map(ChatService.failureReason).join(' | ') : ChatService.failureReason(error);
      if (logEnabled(this.config, 'warn')) this.logger.warn(`Fallaron todos los proveedores (${reasons}).`);
      throw this.unavailable();
    }
  }

  /**
   * Motivo técnico seguro: solo textos fijos de ProviderError («HTTP 429», «tiempo agotado», «respuesta inválida»…),
   * nunca cuerpos de respuesta ni mensajes de errores desconocidos.
   */
  static failureReason(error: unknown): string {
    if (error instanceof ProviderError) return error.message.replace(/^\[[a-z]+\]\s*/, '');
    return 'error inesperado';
  }

  private unavailable() {
    return new ServiceUnavailableException('Mictlán no está disponible en este momento. Intenta de nuevo en un rato.');
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
