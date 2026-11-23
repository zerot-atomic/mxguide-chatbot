import { normalize } from '../places/state-resolver';
import { STATE_HINTS } from '../places/state-hints';

/**
 * Salida de conversación general (texto libre del modelo, sin catálogo).
 * 1) Se ajusta al Markdown limitado del contrato v2.
 * 2) Si afirma datos operativos verificables (precios, horarios, teléfonos), se sustituye completa.
 */
export const CONVERSATION_FALLBACK =
  'Con gusto te ayudo a planear tu viaje por México. Dime qué estado te interesa o comparte tu ubicación y te muestro destinos registrados en MXGuide.';

export function sanitizeConversationReply(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(?:https?:\/\/|www\.)\S+/gi, '')
    .split('\n')
    .filter(line => !/^\s*\|.*\|\s*$/.test(line) && !/^\s*[-:| ]{3,}\s*$/.test(line))
    .map(line => line.replace(/^\s{0,3}#{1,6}\s+/, '').replace(/^\s*[*+]\s+/, '- ').replace(/[ \t]+$/, ''))
    .reduce<string[]>((out, line) => {
      // Las listas siempre quedan separadas del texto por línea en blanco (sin continuación perezosa).
      const item = (l?: string) => l !== undefined && /^(?:- |\d+\. )/.test(l);
      const prev = out[out.length - 1];
      if (line !== '' && prev !== undefined && prev !== '' && item(prev) !== item(line)) out.push('');
      out.push(line);
      return out;
    }, [])
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 1500);
}

const NUMBER_WORDS = '(?:\\d+|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|quince|veinte|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien|ciento|doscientos|trescientos|quinientos|mil|mediodia|medianoche)';
const INVENTED_SPECIFICS = [
  /\$\s?\d/,                                                     // precios con signo
  /\b\d+(?:[.,]\d+)?\s?(?:pesos|mxn|usd|dolares|dólares|euros)\b/i,
  new RegExp(`\\b${NUMBER_WORDS}(?:\\s+(?:mil|cientos?))?\\s+(?:pesos|dolares|euros|mxn|usd)\\b`), // «cien pesos», «ochenta dólares» (texto normalizado)
  /\b(?:entrada|boleto|acceso)\s+(?:es\s+)?(?:gratis|gratuit[ao]|libre)\b/i,
  /\b\d{1,2}[:.]\d{2}\s?(?:h|hrs|am|pm)?\b/i,                  // 9:00
  /\b\d{1,2}\s?(?:am|pm|a\.m\.|p\.m\.)/i,                         // 9 am
  /\b\d{1,2}\s?(?:a|-|–)\s?\d{1,2}\s?(?:h|hrs|horas)\b/i,          // 9 a 17 h
  /\b\d{1,2}\s?(?:h|hrs)\b/i,                                    // 17 h
  new RegExp(`\\b(?:abre|abren|cierra|cierran|horario|atiende|atienden)\\b.{0,40}\\b(?:a las|de las|desde las|hasta las)\\s+${NUMBER_WORDS}\\b`), // «abre a las nueve»
  /\b(?:\+?52[\s-]?)?(?:\d{2,3}[\s-]?)?\d{3,4}[\s-]?\d{4}\b/,   // teléfonos
];

/** Tipos de establecimiento o atractivo que, seguidos de un nombre propio, son un lugar concreto no verificado. */
const PLACE_TYPES = '(?:hotel|hoteles|hostal|hostales|posada|resort|restaurante|restaurantes|fonda|cafeteria|cafe|bar|cantina|museo|museos|parque|parques|playa|playas|zona arqueologica|cascada|cascadas|gruta|grutas|cenote|cenotes|mercado|mercados|templo|templos|catedral|iglesia|piramide|piramides|hacienda|balneario|tour|tours)';
const RECOMMEND_VERBS = '(?:te recomiendo|les recomiendo|recomiendo|no te pierdas|no se pierdan|visita|visiten|visitar|conoce|conozcan|ve a|vayan a|ir a|hospedate en|hospedarte en|quedate en|come en|comer en|cena en|reserva en|prueba el|prueba la)';
const CONNECTORS = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y']);
/** Frase con mayúscula inicial (nombre propio), con conectores en minúscula. Sin bandera i: respeta mayúsculas. */
const PROPER_PHRASE = /(?:(?:de|del|la|las|el|los)\s+)?\p{Lu}[\p{L}'’-]*(?:\s+(?:(?:de|del|la|las|el|los|y)\s+)?\p{Lu}[\p{L}'’-]*)*/uy;
const fold = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

function isAllowedName(phrase: string): boolean {
  const words = normalize(phrase).split(' ').filter(w => !CONNECTORS.has(w));
  return words.length > 0 && words.every(w => w === 'mexico' || STATE_HINTS.some(state => state.split(' ').includes(w)));
}

/**
 * ¿Nombra un lugar concreto no verificado? Busca un tipo de lugar o un verbo de recomendación
 * (sin distinguir mayúsculas) seguido de un nombre propio (con mayúscula). Estados y México se permiten.
 */
function namesUnverifiedPlace(text: string): boolean {
  const folded = fold(text);
  const lower = folded.toLowerCase();
  for (const prefix of [PLACE_TYPES, RECOMMEND_VERBS]) {
    const finder = new RegExp(`(?:^|[^a-z])${prefix}\\s+`, 'g');
    for (const match of lower.matchAll(finder)) {
      PROPER_PHRASE.lastIndex = match.index! + match[0].length;
      const phrase = PROPER_PHRASE.exec(folded)?.[0];
      if (phrase && /\p{Lu}/u.test(phrase) && !isAllowedName(phrase)) return true;
    }
  }
  return false;
}

export function inventsSpecifics(text: string): boolean {
  const folded = fold(text).toLowerCase();
  return INVENTED_SPECIFICS.some(pattern => pattern.test(text) || pattern.test(folded)) || namesUnverifiedPlace(text);
}

export function guardConversationReply(text: string): { reply: string; replaced: boolean } {
  const clean = sanitizeConversationReply(text);
  if (!clean || inventsSpecifics(clean)) return { reply: CONVERSATION_FALLBACK, replaced: true };
  return { reply: clean, replaced: false };
}
