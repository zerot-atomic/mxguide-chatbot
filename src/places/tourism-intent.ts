import { normalize } from './state-resolver';
export type Intent = 'general' | 'ambiguous' | 'attractions' | 'historic' | 'archaeology' | 'culture' | 'nature' | 'religion' | 'lodging' | 'gastronomy' | 'restaurants' | 'dishes';
const rules: [Intent, RegExp][] = [
  ['historic', /\b(historicos?|historicas?|historia|monumentos?)\b/],
  ['archaeology', /\b(arqueologicos?|arqueologicas?|arqueologia|ruinas)\b/],
  ['culture', /\b(museos?|culturales?|cultura)\b/],
  ['nature', /\b(naturales?|naturaleza|cascadas?|bosques?)\b/],
  ['religion', /\b(religiosos?|religiosas?|iglesias?|templos?)\b/],
  ['lodging', /\b(hospedaje|hoteles?|alojamiento|dormir)\b/],
  ['restaurants', /\b(restaurantes?|donde comer|lugares para comer)\b/],
  ['dishes', /\b(platillos?|comida tipica|comidas tipicas|comida tradicional)\b/],
  ['gastronomy', /\b(gastronomia|gastronomicos?|gastronomicas?)\b/],
];
export function classifyIntent(message: string): Intent {
  const text = normalize(message);
  const matches = rules.filter(([, pattern]) => pattern.test(text)).map(([intent]) => intent);
  if (matches.length && /\b(no|sin|excepto|evitar|menos)\b/.test(text)) return 'ambiguous';
  // Gastronomy is the parent of restaurants and traditional dishes.
  const specific = matches.filter(i => i !== 'gastronomy');
  if (specific.length > 1) return 'ambiguous';
  return specific[0] ?? matches[0] ?? (/\b(atracciones|atractivos|visitar|turisticos|turisticas)\b/.test(text) ? 'attractions' : 'general');
}
const categories: Partial<Record<Intent, string[]>> = {
  attractions: ['historico', 'arqueologico', 'cultural', 'natural', 'religioso'],
  historic: ['historico'], archaeology: ['arqueologico'], culture: ['cultural'], nature: ['natural'],
  religion: ['religioso'], lodging: ['hospedaje'], gastronomy: ['gastronomia'], restaurants: ['gastronomia'], dishes: ['gastronomia'],
};
export function categoryNames(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object') return [];
  const associations = (raw as Record<string, unknown>).categories;
  if (!Array.isArray(associations)) return [];
  return [...new Set(associations.flatMap(item => {
    const name = item?.category?.name;
    return typeof name === 'string' && name.trim() ? [name.trim()] : [];
  }))];
}
export function matchesIntent(raw: unknown, intent: Intent): boolean {
  if (intent === 'general') return true;
  const names = categoryNames(raw).map(normalize);
  const allowed = categories[intent] ?? [];
  // Mixed lodging/food records are not presented automatically as attractions.
  return names.some(name => allowed.includes(name)) && !(intent === 'attractions' && names.some(name => ['hospedaje', 'gastronomia'].includes(name)));
}
export function intentInstruction(intent: Intent): string {
  if (intent === 'lodging') return 'Intención: hospedaje. Presenta opciones de alojamiento, no monumentos.';
  if (['gastronomy', 'restaurants', 'dishes'].includes(intent)) return `Intención: ${intent}. La categoría Gastronomía no distingue restaurantes de platillos. Explica esa limitación; no afirmes que un registro es un restaurante o un lugar visitable ni confirmes servicios sin datos explícitos.`;
  if (intent === 'general') return 'Exploración general: presenta cada registro según las categorías confirmadas; si faltan, no deduzcas su tipo ni lo llames restaurante o atracción.';
  return `Intención turística: ${intent}. Los candidatos se filtraron por asociaciones del catálogo, no por sus nombres. No conviertas hoteles o platillos en atracciones.`;
}
