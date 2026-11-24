import { normalize } from './state-resolver';
import { classifyIntent, Intent } from './tourism-intent';
import { mentionsKnownState } from './state-hints';

/** Duración máxima que se reconoce como itinerario (días). Fuera de rango no se inventa otra. */
export const MAX_ITINERARY_DAYS = 7;

const NUMBER_WORDS: Record<string, number> = {
  un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  once: 11, doce: 12, quince: 15, veinte: 20, treinta: 30,
};
const NUMBER = `(\\d{1,3}|${Object.keys(NUMBER_WORDS).join('|')})`;

export interface Duration {
  /** Días pedidos (1–7). Ausente si el usuario no indicó duración o pidió una fuera de rango. */
  days?: number;
  /** El usuario pidió una duración fuera del rango soportado (p. ej. «10 días»). */
  outOfRange?: boolean;
}

/**
 * Duración explícita del mensaje. Solo reconoce lo que el usuario escribió: «N días», «un día»,
 * «día completo», «fin de semana» (= 2). Nunca supone una duración por defecto.
 */
export function extractDuration(message: string): Duration {
  // Expresiones idiomáticas que no indican duración: «un día de estos», «algún día», «cualquier día», «otro día».
  const text = normalize(message).replace(/\b(un dia de estos|un dia de estas|algun dia|cualquier dia|otro dia|el otro dia|un dia antes|un dia despues)\b/g, ' ');
  if (/\bfin(es)? de semana\b/.test(text)) return { days: 2 };
  if (/\b(una|1) semana\b/.test(text)) return { days: 7 };
  if (/\b(dos|tres|cuatro|\d+) semanas\b/.test(text)) return { outOfRange: true };
  const match = new RegExp(`\\b${NUMBER}\\s+dias?\\b`).exec(text);
  if (match) {
    const raw = match[1];
    const days = /^\d+$/.test(raw) ? Number(raw) : NUMBER_WORDS[raw];
    if (!Number.isInteger(days) || days < 1) return {};
    return days <= MAX_ITINERARY_DAYS ? { days } : { outOfRange: true };
  }
  if (/\b(dia completo|todo el dia|en un dia|durante un dia|por un dia)\b/.test(text)) return { days: 1 };
  return {};
}

const PLAN_VERBS = '(planea|planeame|planear|planificar|planifica|organiza|organizame|organizar|prepara|preparame|arma|armame|hazme|disena|disename)';
const PLAN_OBJECTS = '(visita|plan|viaje|ruta|recorrido|escapada|paseo|dias?|fin de semana|estancia)';

/** Solicitud explícita de itinerario en el propio mensaje. */
export function directItinerary(message: string): boolean {
  const text = normalize(message);
  if (/\b(itinerarios?|recorridos?)\b/.test(text)) return true;
  if (new RegExp(`\\b${PLAN_VERBS}\\b.*\\b${PLAN_OBJECTS}\\b`).test(text)) return true;
  if (/\bruta (por|en|de|para)\b/.test(text)) return true;
  if (/\b(recorrer|recorriendo)\b/.test(text)) return true;
  // Una duración explícita junto a una intención de viaje: «¿qué puedo hacer 3 días en Oaxaca?», «2 días en Puebla».
  const duration = extractDuration(message);
  if (duration.days !== undefined || duration.outOfRange) {
    if (/\b(hacer|hago|visitar|visito|conocer|conozco|pasear|paseo|viaje|viajo|viajar|estare|estaremos|pasar|paso)\b/.test(text)) return true;
    // «2 días en Puebla», «fin de semana en Oaxaca» (no «¿qué clima hace en 3 días?»).
    if (/\b(dias?|semana) (en|por)\b/.test(text)) return true;
  }
  return false;
}

/**
 * Itinerario de comida. No depende solo de «gastronomía»: también «comida», «comer», «restaurantes»,
 * «antojitos», «sabores»… El catálogo no distingue restaurantes de platillos, así que se bloquea.
 */
export function foodItinerary(message: string): boolean {
  return /\b(comida|comidas|comer|gastronomic\w*|gastronomia|restaurantes?|platillos?|antojitos|culinari\w*|sabores|cocina tipica|cocina local|fondas?|mercados? de comida)\b/.test(normalize(message));
}

/**
 * Muletillas y expresiones introductorias que no cambian el sentido de un seguimiento:
 * «Perdón, mejor 5 días», «No, mejor en Oaxaca», «Oye, ¿qué más hay?», «Ok, entonces 5 días».
 * Solo se usan para reconocer seguimientos; nunca para decidir el estado ni la intención.
 */
const LEAD_IN = /^(perdon|perdona|perdone|disculpa|disculpe|disculpame|oye|oiga|ok|okay|okey|oki|bueno|entonces|mejor dicho|mmm+|mm|ah+|eh|este|pues|va|vale|ya|o sea|osea|a ver|sabes que|sabes)\b\s*/;
/** «No» y «sí» solo son muletilla seguidos de puntuación («No, mejor…», «Sí, 5 días»); «no quiero…» o «si visito…» conservan su sentido. */
const PUNCTUATED_LEAD_IN = /^\s*[¡¿]?\s*(no|si|sí)\s*[,.;:!…]+\s*/i;

/** Texto normalizado sin muletillas iniciales (repetidas: «no, perdón, mejor…»). */
export function stripLeadIns(message: string): string {
  let raw = message.trim();
  for (let i = 0; i < 8; i++) {
    const punctuated = PUNCTUATED_LEAD_IN.exec(raw);
    if (punctuated && punctuated[0].length < raw.length) { raw = raw.slice(punctuated[0].length); continue; }
    const normalized = normalize(raw);
    const leadIn = LEAD_IN.exec(normalized);
    // Nunca se elimina el mensaje completo («ok», «bueno» solos se conservan).
    if (!leadIn || leadIn[0].trim().length >= normalized.length) break;
    raw = dropLeadingWords(raw, leadIn[0].trim().split(' ').length);
  }
  return normalize(raw);
}

/** Quita las primeras N palabras del texto original, con su puntuación. */
function dropLeadingWords(raw: string, count: number): string {
  let rest = raw.trimStart();
  for (let i = 0; i < count; i++) rest = rest.replace(/^[^\p{L}\p{N}]*[\p{L}\p{N}]+[^\p{L}\p{N}\s]*\s*/u, '');
  return rest;
}

/** Mensaje sin muletillas para resolver estado e intención (evita que «No, mejor en Oaxaca» sea una exclusión). */
export function withoutLeadIns(message: string): string {
  const stripped = stripLeadIns(message);
  return stripped === normalize(message) ? message : stripped;
}

/**
 * Duración aislada: «5 días», «solo 3 días», «una semana», «de 5 días nada más». Solo cuenta como
 * seguimiento dentro de una cadena de itinerario (ver itineraryContext); por sí sola no es turística.
 */
export function bareDuration(message: string): boolean {
  const text = stripLeadIns(message);
  const duration = extractDuration(message);
  if (duration.days === undefined && !duration.outOfRange) return false;
  return new RegExp(`^(mejor |solo |nada mas |unicamente |solamente |que sean |que sea |serian |seran |son |de |por |durante |para |mejor de |solo de |mejor solo )*(${NUMBER} dias?|${NUMBER} semanas?|(un |una )?fin(es)? de semana|un dia|dia completo|todo el dia)( nada mas| solamente| nomas| entonces| mejor| por favor)*$`).test(text);
}

/** Cambio de estado dentro de un seguimiento: «mejor en Oaxaca», «no, mejor por Chiapas», «¿y en Puebla?». */
export function stateChangeRequest(message: string): boolean {
  const text = stripLeadIns(message);
  return text.split(' ').length <= 7 && /^(y |mejor |ahora |mejor dicho |entonces )*(en|por|a|para) \S/.test(text) && mentionsKnownState(message);
}

/** Cambio de duración sobre el itinerario anterior: «mejor que sean 2 días», «ahora solo un día». */
export function durationChange(message: string): boolean {
  const text = stripLeadIns(message);
  const duration = extractDuration(message);
  return (duration.days !== undefined || duration.outOfRange === true) && text.split(' ').length <= 10
    && /^(y |mejor|ahora|cambia|cambialo|cambiamos|que sean|que sea|solo|mejor solo|hazlo|hazlo de|mejor de|para|en realidad|pero)\b/.test(text);
}

/** Agregar algo al itinerario anterior: «agrega un museo», «añade algo cultural», «incluye una iglesia». */
export function additionRequest(message: string): boolean {
  return /^(agrega|agregale|anade|anadele|incluye|incluyele|suma|sumale|pon|ponle|mete|metele|tambien)\b/.test(stripLeadIns(message));
}

/** «¿Qué más?», «¿qué otros?», «otros lugares»: pide más de la misma búsqueda. */
export function moreRequest(message: string): boolean {
  const text = stripLeadIns(message).replace(/^y /, '');
  return text.split(' ').length <= 7
    && /^(que mas|cuales mas|que otros|que otras|algo mas|mas|otros|otras|alguno mas|alguna mas|dame mas|muestrame mas|ensename mas)\b/.test(text);
}

/** Seguimiento de un itinerario (con o sin muletillas). También lo usa la resolución de estado del historial. */
export const isItineraryContinuation = (message: string): boolean => continuation(message);

const continuation = (message: string) =>
  /^(y\b|uno\b|otro\b|otra\b)/.test(stripLeadIns(message)) || durationChange(message) || additionRequest(message)
  || moreRequest(message) || bareDuration(message) || stateChangeRequest(message);

export interface ItineraryContext {
  itinerary: boolean;
  inheritedIntent?: Intent;
  /** Duración vigente: la del mensaje, o la del itinerario anterior si el mensaje no la cambia. */
  duration: Duration;
  /** El mensaje es un seguimiento de un itinerario previo (no lo pide de nuevo de forma directa). */
  followup: boolean;
}

/**
 * Presentación, categoría y duración se recuerdan localmente (últimos 12 turnos, solo turnos del usuario
 * en una cadena contigua de continuaciones). Ningún historial se envía a la IA en esta ruta.
 */
export function itineraryContext(message: string, history: { role: string; content: string }[]): ItineraryContext {
  const users = history.slice(-12).filter(t => t.role === 'user').reverse();
  const direct = directItinerary(message);
  let itinerary = direct;
  let inheritedIntent: Intent | undefined;
  let duration = extractDuration(message);
  const ownDuration = duration.days !== undefined || duration.outOfRange === true;
  let followup = false;
  if (direct || continuation(message)) {
    for (const user of users) {
      const intent = classifyIntent(user.content);
      if (!inheritedIntent && intent !== 'general') inheritedIntent = intent;
      if (!ownDuration && duration.days === undefined && !duration.outOfRange) duration = extractDuration(user.content);
      if (directItinerary(user.content)) {
        if (!direct) followup = true;
        itinerary = true;
        break;
      }
      if (!continuation(user.content)) break;
    }
  }
  if (!itinerary) duration = {};
  return { itinerary, inheritedIntent, duration, followup };
}
