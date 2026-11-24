import { PlaceSummary } from './places.service';
import { legacyEscaped, markdownSafe } from '../chat/response-contract';
import { MAX_ITINERARY_STOPS } from './itinerary-plan';

/** Líneas de lista reconocidas: «- » o numeradas de uno o dos dígitos (itinerarios de hasta 21 paradas). */
const LIST_LINE = /^(?:- |\d{1,2}\. )/;

/** History can only narrow a fresh catalogue selection, never create records. */
export function previousRecommendationIds(history: {role: string;content: string}[], candidates: PlaceSummary[]): Set<string> | null {
  const recent = history.slice(-12);
  const lastUser = recent.map(t => t.role).lastIndexOf('user');
  const previousReply = recent.slice(lastUser + 1).filter(t => t.role === 'assistant').at(-1)?.content;
  if (lastUser < 0 || !previousReply) return null;
  // Los encabezados «**Día N**» no son líneas de lista y se ignoran. Más de 21 elementos no es una respuesta de Mictlán.
  const lines = previousReply.slice(0, 4000).split('\n').filter(line => LIST_LINE.test(line)).slice(0, MAX_ITINERARY_STOPS + 1);
  if (!lines.length || lines.length > MAX_ITINERARY_STOPS) return null;
  const ids = new Set<string>();
  for (const rawLine of lines) {
    const line = rawLine.replace(/^\d{1,2}\. /, '- ');
    const matches = candidates.filter(p => {
      // v2 escribe **Nombre**; v1 escapaba caracteres con "\\". Se aceptan ambos para historiales previos.
      const prefixes = ['- **' + markdownSafe(p.name) + '**', '- ' + legacyEscaped(p.name)];
      return prefixes.some(prefix => line === prefix || [': ', ' (', ' · a '].some(separator => line.startsWith(prefix + separator)));
    });
    // Stale/unmatched items are omitted; ambiguous names require clarification.
    if (matches.length > 1) return null;
    if (matches.length === 1) ids.add(matches[0].id);
  }
  return ids;
}
