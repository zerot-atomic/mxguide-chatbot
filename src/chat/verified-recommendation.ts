import { hasExternalReference } from '../common/external-data';
import { markdownSafe, ReplyKind } from './response-contract';
import { MAX_ITINERARY_DAYS } from '../places/itinerary';
import { ItineraryPlan, PlannedDay, itineraryTarget, planItineraryDays } from '../places/itinerary-plan';
import { normalize } from '../places/state-resolver';
import { Intent } from '../places/tourism-intent';
import { CatalogContext, PlaceSummary } from '../places/places.service';

/** The model selects records, never supplies public facts or card data. */
export interface Selection { places: PlaceSummary[]; message?: unknown }

/** Máximo de IDs que el modelo puede seleccionar sin itinerario por días. */
export const DEFAULT_MAX_SELECTION = 5;

function parseSelection(text: unknown, candidates: PlaceSummary[], maxIds = DEFAULT_MAX_SELECTION): Selection | null {
  if (typeof text !== 'string' || text.length > 16000) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record);
  if (!keys.includes('placeIds') || keys.some(k => k !== 'placeIds' && k !== 'message')) return null;
  if (!Array.isArray(record.placeIds) || record.placeIds.length > maxIds) return null;
  const ids = record.placeIds;
  if (ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length) return null;
  const byId = new Map(candidates.map(p => [p.id, p]));
  if (ids.some(id => !byId.has(id))) return null;
  return { places: ids.map(id => byId.get(id)!), message: record.message };
}

/** The model selects records, never supplies public facts or card data. */
export function validateSelection(text: unknown, candidates: PlaceSummary[], maxIds = DEFAULT_MAX_SELECTION): PlaceSummary[] | null {
  return parseSelection(text, candidates, maxIds)?.places ?? null;
}

/** Itinerario con duración conocida: se distribuye por días (etapa 3). */
export function isPlannedItinerary(context: CatalogContext): context is CatalogContext & { itineraryDays: number } {
  return Boolean(context.itinerary) && typeof context.itineraryDays === 'number';
}

/** Máximo de IDs que el selector puede devolver para este contexto (5, o días × 3 hasta 21 en itinerarios). */
export function selectionLimit(context: CatalogContext, available = context.places.length): number {
  return isPlannedItinerary(context) ? Math.max(1, itineraryTarget(context.itineraryDays, available)) : DEFAULT_MAX_SELECTION;
}

/** Palabras de datos operativos o de control que el texto libre no puede afirmar. */
const SENSITIVE = /\b(abiert\w*|cerrad\w*|horari\w*|precio\w*|costo\w*|tarifa\w*|gratis|gratuit\w*|entrada\w*|servicio\w*|disponib\w*|reserva\w*|incluy\w*|incluid\w*|ofrece\w*|ofrecen|wifi|estacionamiento|desayuno|piscina|alberca|telefono|contacto|direccion|garantiz\w*|instruccion\w*|ignora\w*|prompt|system|assistant|modelo|groq|gemini|json|uuid|revela\w*|ejecuta\w*|pesos|dolares|km|kilometros?|minutos?|horas?)\b/;

/** Palabras con mayúscula que una introducción puede usar al inicio de frase. */
const SENTENCE_OPENERS = new Set(['que', 'aqui', 'te', 'para', 'si', 'esta', 'estas', 'estos', 'este', 'mira', 'hay', 'con', 'tienes', 'encontre',
  'excelente', 'buena', 'buen', 'claro', 'perfecto', 'me', 'en', 'una', 'un', 'las', 'los', 'el', 'la', 'descubre', 'conoce', 'explora', 'vamos',
  'listo', 'genial', 'hola', 'por', 'asi', 'puedes', 'seguro', 'ojala', 'tu', 'tus', 'estas', 'empieza', 'comienza', 'disfruta', 'ahora',
  'muy', 'gran', 'grandes', 'lindo', 'linda', 'bonito', 'bonita', 'excelentes', 'buenisima', 'buenisimo', 'wow', 'ah', 'oh', 'va', 'aca', 'de']);
/** Nombres propios siempre permitidos en una introducción (marca y país). */
const ALWAYS_ALLOWED = new Set(['mexico', 'mxguide', 'mictlan']);

/**
 * Introducción redactada por el modelo: solo tono, sin hechos. Se descarta completa ante cualquier duda
 * y se usa la plantilla. Además de cifras, enlaces, Markdown y datos operativos, rechaza todo nombre propio
 * que no sea el estado consultado (otro estado, un lugar fuera de la lista blanca, un hotel o restaurante).
 */
export function validateIntro(message: unknown, candidates: PlaceSummary[], allowedNames: string[] = []): string | undefined {
  if (typeof message !== 'string') return undefined;
  const text = message.trim().replace(/\s+/g, ' ');
  if (text.length < 8 || text.length > 280 || /[\r\n]/.test(message.trim())) return undefined;
  if (/[0-9$\\`*_~\[\]<>#|{}]/.test(text) || hasExternalReference(text) || /https?:|www\./i.test(text)) return undefined;
  const normalized = ' ' + normalize(text) + ' ';
  if (SENSITIVE.test(normalized)) return undefined;
  if (candidates.some(p => { const name = normalize(p.name); return name.length >= 4 && normalized.includes(' ' + name + ' '); })) return undefined;
  // Texto real: al menos tres palabras con letras y casi todo alfabético.
  const words = text.match(/[\p{L}]+/gu) ?? [];
  if (words.length < 3 || words.join('').length < text.replace(/[\s\p{P}]/gu, '').length * 0.9) return undefined;
  if (words.some(w => w.length > 25 || /(.)\1{3,}/i.test(w))) return undefined;
  // Nombres propios: solo el estado consultado, México y la marca.
  const allowed = new Set([...ALWAYS_ALLOWED, ...allowedNames.flatMap(n => normalize(n).split(' '))]);
  const tokens = text.split(/\s+/);
  for (let i = 0; i < tokens.length; i++) {
    const word = tokens[i].replace(/^[¡¿"'(«]+|[.,;:!?"')»]+$/g, '');
    if (!/^\p{Lu}/u.test(word)) continue;
    const key = normalize(word);
    const startsSentence = i === 0 || /[.!?]$/.test(tokens[i - 1]);
    if (allowed.has(key) || (startsSentence && SENTENCE_OPENERS.has(key))) continue;
    return undefined;
  }
  return text;
}

export interface ItineraryField { requestedDays: number; days: PlannedDay[] }
export interface VerifiedReply {
  reply: string; places: PlaceSummary[]; kind: ReplyKind; fallback: boolean; natural: boolean;
  /** Solo en itinerarios con duración conocida y al menos un destino. */
  itinerary?: ItineraryField;
}

/** Longitud máxima del reply de un itinerario: debe caber en un turno de historial (4000) con margen. */
export const ITINERARY_REPLY_BUDGET = 3800;

export function verifiedRecommendation(text: unknown, context: CatalogContext): VerifiedReply {
  // The only input to this whitelist is the already filtered backend result.
  const candidates = context.places.filter(p => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p.id) && typeof p.name === 'string' && p.name.trim());
  const planned = isPlannedItinerary(context);
  const limit = selectionLimit(context, candidates.length);
  const parsed = parseSelection(text, candidates, limit);
  const selection = parsed?.places ?? null;
  // Itinerarios conservan su plantilla.
  const natural = context.itinerary ? undefined : validateIntro(parsed?.message, context.places, context.state ? [context.state.name] : []);
  // Fallback determinista: primeros candidatos válidos en orden del catálogo (3, o el objetivo del itinerario).
  const selectedPlaces = selection ?? candidates.slice(0, planned ? limit : 3);
  const plan: ItineraryPlan<PlaceSummary> | undefined = planned && selectedPlaces.length ? planItineraryDays(selectedPlaces, context.itineraryDays) : undefined;
  const places = plan ? plan.ordered : selectedPlaces;
  if (!places.length) {
    // Hubo candidatos del catálogo, pero ninguno se seleccionó como pertinente a lo pedido.
    const where = context.state ? ' de ' + displayText(context.state.name) : context.mode === 'nearby' ? ' cercanos' : '';
    const asked = context.requestedType ? context.requestedType.label : 'lo que buscas';
    return {
      reply: `Entre los destinos${where} registrados en MXGuide no encontré opciones que correspondan a ${asked}. ¿Quieres que te muestre otros atractivos${where}?`,
      places: [], kind: 'empty', fallback: selection === null, natural: false,
    };
  }
  const scope = context.state ? ' en ' + displayText(context.state.name) : context.mode === 'nearby' ? ' cerca de ti' : '';
  const intro = context.requestedType
    ? 'Estos destinos de MXGuide mencionan ' + context.requestedType.label
    : introductions[context.intent ?? 'general'] ?? introductions.general;
  const line = (p: PlaceSummary, index: number, detail: 'full' | 'type' | 'name') => {
    const description = detail === 'full' ? briefDescription(p.description) : '';
    const distance = !context.itinerary && context.mode === 'nearby' && typeof p.distanceKm === 'number' && Number.isFinite(p.distanceKm) && p.distanceKm >= 0 ? ' · a ' + p.distanceKm.toFixed(2) + ' km' : '';
    const type = detail !== 'name' && (!context.intent || context.intent === 'general') ? generalType(p.category) : '';
    return (context.itinerary ? (index + 1) + '. ' : '- ') + '**' + displayText(p.name) + '**' + (type ? ' (' + type + ')' : '') + distance + (description ? ': ' + displayText(description) : '');
  };
  // Itinerario por días: bloques «**Día N**» con numeración global continua (el destino N es places[N-1]).
  const body = (detail: 'full' | 'type' | 'name') => plan
    ? plan.days.map(day => `**Día ${day.day}**\n\n` + day.placeIds.map(id => { const index = places.findIndex(p => p.id === id); return line(places[index], index, detail); }).join('\n')).join('\n\n')
    : places.map((p, index) => line(p, index, detail)).join('\n');
  const food = places.some(p => normalize(p.category).split(' ').includes('gastronomia'));
  const compose = (detail: 'full' | 'type' | 'name') => (selection === null ? 'Te comparto una selección de MXGuide. ' : '') + (context.itinerary ? 'Itinerario sugerido para conocer' + (context.state ? ' ' + displayText(context.state.name) : ' estos destinos') + itineraryDaysLabel(context.itineraryDays) : natural ? (/[.:!?]$/.test(natural) ? natural.slice(0, -1) : natural) : intro + scope) + ':\n\n' + body(detail)
      + (food ? '\n\nPara explorar la gastronomía local, ten en cuenta que esta selección puede incluir platillos y establecimientos; no confirma que todos sean lugares visitables ni restaurantes.' : '')
      + (context.itinerary ? itineraryNotice(context, plan) : '\n\nSon algunas opciones para empezar. Confirma horarios, precios y servicios antes de planear una visita.');
  // Un itinerario largo debe caber en un turno de historial: se omiten descripciones y luego tipos si hace falta.
  let reply = compose('full');
  if (plan && reply.length > ITINERARY_REPLY_BUDGET) reply = compose('type');
  if (plan && reply.length > ITINERARY_REPLY_BUDGET) reply = compose('name');
  return {
    reply,
    places,
    kind: context.itinerary ? 'itinerary' : 'recommendation',
    fallback: selection === null,
    natural: Boolean(natural),
    ...(plan ? { itinerary: { requestedDays: plan.requestedDays, days: plan.days } } : {}),
  };
}

const introductions: Partial<Record<Intent, string>> & { general: string } = {
  general: 'Aquí tienes algunas opciones para explorar',
  attractions: 'Para descubrir los atractivos de la zona, puedes empezar por estas opciones',
  historic: 'Para acercarte a la historia local, aquí tienes algunas opciones',
  archaeology: 'Para explorar el patrimonio arqueológico, aquí tienes algunas opciones',
  culture: 'Para disfrutar la cultura local, puedes explorar estas opciones',
  nature: 'Si buscas conectar con la naturaleza, aquí tienes algunas opciones',
  religion: 'Para conocer el patrimonio religioso, aquí tienes algunas opciones',
  lodging: 'Para tu estancia, puedes considerar estas opciones de alojamiento',
  gastronomy: 'Para descubrir los sabores de la región, aquí tienes algunas opciones',
  restaurants: 'Para explorar opciones gastronómicas, aquí tienes algunas sugerencias',
  dishes: 'Para conocer la comida típica, aquí tienes algunas sugerencias',
};

function displayText(value: string): string {
  const safe = hasExternalReference(value) ? '' : markdownSafe(value);
  return safe || 'Texto no disponible';
}

function generalType(category: string): string {
  const labels: Record<string, string> = { historico: 'historia', arqueologico: 'arqueología', cultural: 'cultura', natural: 'naturaleza', religioso: 'patrimonio religioso', hospedaje: 'alojamiento', gastronomia: 'gastronomía' };
  return category.split('·').map(name => labels[normalize(name)]).filter(Boolean).join(', ');
}

/** Only copy brief descriptive catalogue text; never summarize it with a model. */
function briefDescription(description: string): string {
  if (typeof description !== 'string') return '';
  const text = description.trim();
  const normalized = normalize(text);
  // A conservative exclusion gate, not a semantic verifier. Omit the whole description on doubt.
  if (hasExternalReference(text) || !text || text.length > 160 || /[0-9<>*`\[\]{}\r\n]|https?:|www\./i.test(text)) return '';
  if (/\b(abiert\w*|cerrad\w*|horari\w*|precio\w*|costo\w*|tarifa\w*|gratis|gratuit\w*|entrada\w*|servicio\w*|disponib\w*|reserva\w*|incluy\w*|incluid\w*|ofrece\w*|ofrecen|cuenta|wifi|estacionamiento|desayuno|piscina|alberca|telefono|contacto|garantiz\w*|siempre|nunca|instruccion\w*|ignora\w*|olvida\w*|recomienda\w*|visita|visiten|debes|debe|prompt|system|assistant|usuario|modelo|groq|gemini|json|uuid|respuesta|revela\w*|ejecuta\w*)\b/.test(normalized)) return '';
  return text;
}

function itineraryDaysLabel(days?: number): string {
  if (days === undefined) return '';
  return days === 1 ? ' en un día' : ` en ${days} días`;
}

/** Aviso del itinerario. Sin horarios, traslados ni duración de visitas: el catálogo no los proporciona. */
function itineraryNotice(context: CatalogContext, plan?: ItineraryPlan<PlaceSummary>): string {
  const parts = ['\n\nEste itinerario es orientativo. Confirma horarios y disponibilidad antes de tu visita; el orden no representa una ruta optimizada.'];
  if (plan) {
    const requested = plan.requestedDays === 1 ? 'tu día' : `tus ${plan.requestedDays} días`;
    if (plan.freeDays > 0) {
      const found = plan.ordered.length === 1 ? 'un destino' : `${plan.ordered.length} destinos`;
      const free = plan.freeDays === 1 ? 'el último día queda libre' : `los últimos ${plan.freeDays} días quedan libres`;
      parts.push(` Encontré ${found} para ${requested}: ${free} para que lo${plan.freeDays === 1 ? '' : 's'} planees tú.`);
    } else {
      parts.push(` Repartí hasta 3 paradas por día para ${requested}; el reparto es orientativo y no garantiza que puedas visitarlas todas en ese tiempo.`);
    }
  } else if (context.itineraryDaysOutOfRange) {
    parts.push(` Por ahora preparo itinerarios de 1 a ${MAX_ITINERARY_DAYS} días; te comparto opciones sin ajustarlas a la duración que mencionaste.`);
  } else {
    parts.push(' Si me dices cuántos días tienes (de 1 a ' + MAX_ITINERARY_DAYS + '), lo tomo en cuenta.');
  }
  return parts.join('');
}
