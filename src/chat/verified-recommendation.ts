import { hasExternalReference } from '../common/external-data';
import { normalize } from '../places/state-resolver';
import { Intent } from '../places/tourism-intent';
import { CatalogContext, PlaceSummary } from '../places/places.service';

/** The model selects records, never supplies public facts or card data. */
export function validateSelection(text: unknown, candidates: PlaceSummary[]): PlaceSummary[] | null {
  if (typeof text !== 'string' || text.length > 16000) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || !Array.isArray(record.placeIds) || record.placeIds.length > 5) return null;
  const ids = record.placeIds;
  if (ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length) return null;
  const byId = new Map(candidates.map(p => [p.id, p]));
  if (ids.some(id => !byId.has(id))) return null;
  return ids.map(id => byId.get(id)!);
}

export function verifiedRecommendation(text: unknown, context: CatalogContext): { reply: string; places: PlaceSummary[] } {
  // The only input to this whitelist is the already filtered backend result.
  const candidates = context.places.filter(p => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p.id) && typeof p.name === 'string' && p.name.trim());
  const selection = validateSelection(text, candidates);
  const places = selection ?? candidates.slice(0, 3);
  if (!places.length) return { reply: 'No tengo una selección verificable para recomendarte. Puedes precisar qué deseas consultar; esto no significa que no existan registros en MXGuide.', places: [] };
  const scope = context.state ? ' en ' + displayText(context.state.name) : context.mode === 'nearby' ? ' cerca de ti' : '';
  const intro = introductions[context.intent ?? 'general'] ?? introductions.general;
  const lines = places.map(p => {
    const description = briefDescription(p.description);
    const distance = context.mode === 'nearby' && typeof p.distanceKm === 'number' && Number.isFinite(p.distanceKm) && p.distanceKm >= 0 ? ' · a ' + p.distanceKm + ' km' : '';
    const type = !context.intent || context.intent === 'general' ? generalType(p.category) : '';
    return '- ' + displayText(p.name) + (type ? ' (' + type + ')' : '') + distance + (description ? ': ' + displayText(description) : '');
  });
  const food = places.some(p => normalize(p.category).split(' ').includes('gastronomia'));
  return {
    reply: (selection === null ? 'Te comparto una selección de MXGuide. ' : '') + intro + scope + ':\n' + lines.join('\n')
      + (food ? '\nPara explorar la gastronomía local, ten en cuenta que esta selección puede incluir platillos y establecimientos; no confirma que todos sean lugares visitables ni restaurantes.' : '')
      + '\nSon algunas opciones para empezar. Confirma horarios, precios y servicios antes de planear una visita.',
    places,
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
  return (hasExternalReference(value) ? 'Texto no disponible' : value).replace(/[\r\n\t]/g, ' ').replace(/[<>*_`\[\]\\]/g, char => '\\' + char);
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
