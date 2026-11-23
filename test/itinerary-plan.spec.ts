import { Logger } from '@nestjs/common';
import { ChatResponse, ChatService } from '../src/chat/chat.service';
import { PlaceSummary, PlacesService } from '../src/places/places.service';
import { LlmRequest } from '../src/chat/providers/llm-provider';
import { loadConfig } from '../src/config/env';
import {
  ITINERARY_CANDIDATE_LIMIT, MAX_ITINERARY_STOPS, STOPS_PER_DAY, interleaveByCategory, itineraryTarget, planItineraryDays,
} from '../src/places/itinerary-plan';
import { previousRecommendationIds } from '../src/places/followup-context';
import { ITINERARY_REPLY_BUDGET, selectionLimit, validateSelection } from '../src/chat/verified-recommendation';

/** Itinerarios — etapa 3 (distribución por días) y etapa 4 (campo opcional «itinerary»). */
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const CATS = ['Histórico', 'Cultural', 'Arqueológico', 'Natural', 'Religioso'];
const stop = (n: number, category = CATS[n % CATS.length]) => ({ id: id(n), category });
const stops = (count: number, category?: string) => Array.from({ length: count }, (_, i) => stop(i + 1, category));
const sizes = (plan: { days: { placeIds: string[] }[] }) => plan.days.map(d => d.placeIds.length);

/** Reglas del contrato «itinerary» (etapa 4) sobre una respuesta HTTP/servicio. */
function assertItineraryContract(r: ChatResponse, requestedDays: number) {
  expect(r.kind).toBe('itinerary');
  expect(r.itinerary).toBeDefined();
  const it = r.itinerary!;
  expect(it.requestedDays).toBe(requestedDays);
  expect(it.days.length).toBeGreaterThan(0);
  expect(it.days.length).toBeLessThanOrEqual(requestedDays);
  it.days.forEach((d, i) => {
    expect(d.day).toBe(i + 1);
    expect(d.placeIds.length).toBeGreaterThan(0);
    expect(d.placeIds.length).toBeLessThanOrEqual(STOPS_PER_DAY);
  });
  const flat = it.days.flatMap(d => d.placeIds);
  expect(new Set(flat).size).toBe(flat.length);
  expect(flat).toEqual(r.places.map(p => p.id));
  expect(Object.keys(it).sort()).toEqual(['days', 'requestedDays']);
  // La numeración global del reply corresponde a places[N-1].
  const numbered = r.reply.split('\n').filter(l => /^\d{1,2}\. /.test(l));
  expect(numbered).toHaveLength(r.places.length);
  numbered.forEach((line, i) => expect(line.startsWith(`${i + 1}. **`)).toBe(true));
  // Bloques «**Día N**» en orden y sin datos operativos inventados.
  const headers = r.reply.split('\n').filter(l => /^\*\*Día \d\*\*$/.test(l));
  expect(headers).toEqual(it.days.map(d => `**Día ${d.day}**`));
  expect(r.reply).not.toMatch(/\b\d{1,2}:\d{2}\b|\d+ ?km\b|minutos|\$\d|\bpesos\b|ruta (más |mas )?(corta|eficiente|óptima)|optimizamos/);
  expect(r.reply).toContain('el orden no representa una ruta optimizada');
}

describe('Etapa 3 · planificador puro (itinerary-plan.ts)', () => {
  it('constantes: 3 por día, 21 en total, 30 candidatos', () => {
    expect([STOPS_PER_DAY, MAX_ITINERARY_STOPS, ITINERARY_CANDIDATE_LIMIT]).toEqual([3, 21, 30]);
  });

  it.each([1, 2, 3, 4, 5, 6, 7])('%i día(s) con 30 destinos: 3 por día exactos', days => {
    const plan = planItineraryDays(stops(30), days);
    expect(sizes(plan)).toEqual(Array(days).fill(3));
    expect(plan.days.map(d => d.day)).toEqual(Array.from({ length: days }, (_, i) => i + 1));
    expect(plan.freeDays).toBe(0);
  });

  it.each([
    [10, 4, [3, 3, 2, 2]], [21, 7, [3, 3, 3, 3, 3, 3, 3]], [13, 5, [3, 3, 3, 2, 2]], [7, 3, [3, 2, 2]],
    [5, 2, [3, 2]], [8, 7, [2, 1, 1, 1, 1, 1, 1]], [2, 1, [2]], [6, 6, [1, 1, 1, 1, 1, 1]],
  ])('%i destinos en %i días → %j', (count, days, expected) => {
    const plan = planItineraryDays(stops(count), days);
    expect(sizes(plan)).toEqual(expected);
    expect(Math.max(...sizes(plan)) - Math.min(...sizes(plan))).toBeLessThanOrEqual(1);
  });

  it('menos destinos que días: días consecutivos, sin días vacíos y días libres informados', () => {
    const plan = planItineraryDays(stops(4), 7);
    expect(plan.days).toEqual([1, 2, 3, 4].map((day, i) => ({ day, placeIds: [plan.ordered[i].id] })));
    expect(plan.freeDays).toBe(3);
    expect(plan.requestedDays).toBe(7);
  });

  it('un solo destino', () => {
    const plan = planItineraryDays(stops(1), 5);
    expect(plan.days).toEqual([{ day: 1, placeIds: [id(1)] }]);
    expect(plan.freeDays).toBe(4);
  });

  it('sin destinos: sin días', () => {
    expect(planItineraryDays([], 3)).toMatchObject({ days: [], ordered: [], freeDays: 3 });
  });

  it('límites: nunca más de 3 por día ni de 21 en total', () => {
    for (let days = 1; days <= 7; days++) for (let count = 0; count <= 40; count += 3) {
      const plan = planItineraryDays(stops(count), days);
      expect(plan.ordered.length).toBe(Math.min(count, days * 3, 21));
      expect(Math.max(0, ...sizes(plan))).toBeLessThanOrEqual(3);
    }
  });

  it('elimina duplicados e IDs vacíos sin perder destinos válidos', () => {
    const plan = planItineraryDays([stop(1), stop(1), { id: '', category: 'Cultural' }, stop(2), stop(2), stop(3)], 3);
    expect(plan.ordered.map(s => s.id)).toEqual([id(1), id(2), id(3)]);
    const flat = plan.days.flatMap(d => d.placeIds);
    expect(new Set(flat).size).toBe(flat.length);
  });

  it('determinista: misma entrada, misma salida', () => {
    const input = stops(17);
    expect(planItineraryDays(input, 6)).toEqual(planItineraryDays([...input], 6));
    expect(JSON.stringify(planItineraryDays(input, 6))).toBe(JSON.stringify(planItineraryDays(stops(17), 6)));
  });

  it('alterna categorías cuando hay variedad (sin dos consecutivas iguales si es posible)', () => {
    const input = [stop(1, 'Cultural'), stop(2, 'Cultural'), stop(3, 'Cultural'), stop(4, 'Natural'), stop(5, 'Natural'), stop(6, 'Histórico')];
    const order = interleaveByCategory(input).map(s => s.category);
    expect(order).toEqual(['Cultural', 'Natural', 'Histórico', 'Cultural', 'Natural', 'Cultural']);
    const plan = planItineraryDays(input, 2);
    expect(plan.days[0].placeIds).toEqual([id(1), id(4), id(6)]);
  });

  it('usa la primera categoría de registros con varias y agrupa los que no tienen categoría', () => {
    const input = [stop(1, 'Histórico · Cultural'), stop(2, 'Histórico'), stop(3, ''), stop(4, '')];
    expect(interleaveByCategory(input).map(s => s.id)).toEqual([id(1), id(3), id(2), id(4)]);
  });

  it('categorías iguales o sin variedad: conserva el orden de entrada y no descarta nada', () => {
    const same = stops(8, 'Cultural');
    expect(interleaveByCategory(same)).toEqual(same);
    expect(planItineraryDays(same, 3).ordered).toEqual(same);
  });

  it('itineraryTarget = min(días × 3, 21, disponibles); días fuera de rango se acotan', () => {
    expect(itineraryTarget(3, 30)).toBe(9);
    expect(itineraryTarget(7, 30)).toBe(21);
    expect(itineraryTarget(7, 4)).toBe(4);
    expect(itineraryTarget(10, 40)).toBe(21);
    expect(itineraryTarget(0, 10)).toBe(3);
  });
});

describe('Etapa 3 · selección y validación', () => {
  const candidates = Array.from({ length: 30 }, (_, i) => ({ id: id(i + 1), name: `D${i + 1}`, state: 'Puebla', category: 'Cultural', description: '' }));
  const ids = (n: number, from = 1) => Array.from({ length: n }, (_, i) => id(from + i));

  it('acepta hasta el máximo indicado (21) y rechaza si lo excede', () => {
    expect(validateSelection(JSON.stringify({ placeIds: ids(21) }), candidates, 21)).toHaveLength(21);
    expect(validateSelection(JSON.stringify({ placeIds: ids(22) }), candidates, 21)).toBeNull();
  });

  it('sin duración conserva el máximo de 5', () => {
    expect(validateSelection(JSON.stringify({ placeIds: ids(6) }), candidates)).toBeNull();
    expect(validateSelection(JSON.stringify({ placeIds: ids(5) }), candidates)).toHaveLength(5);
  });

  it('rechaza IDs inexistentes, ajenos o duplicados', () => {
    expect(validateSelection(JSON.stringify({ placeIds: [id(1), id(99)] }), candidates, 21)).toBeNull();
    expect(validateSelection(JSON.stringify({ placeIds: [id(1), id(1)] }), candidates, 21)).toBeNull();
    expect(validateSelection(JSON.stringify({ placeIds: ['no-uuid'] }), candidates, 21)).toBeNull();
  });

  it('selectionLimit: 5 sin duración; días × 3 hasta 21 con duración', () => {
    const base = { status: 'found' as const, mode: 'state' as const, places: candidates as PlaceSummary[] };
    expect(selectionLimit(base)).toBe(5);
    expect(selectionLimit({ ...base, itinerary: true })).toBe(5);
    expect(selectionLimit({ ...base, itinerary: true, itineraryDays: 2 })).toBe(6);
    expect(selectionLimit({ ...base, itinerary: true, itineraryDays: 7 })).toBe(21);
    expect(selectionLimit({ ...base, itinerary: true, itineraryDays: 7, places: candidates.slice(0, 4) as PlaceSummary[] })).toBe(4);
  });
});

// ---------- Integración con catálogo simulado ----------
const puebla = { id: id(1001), name: 'Puebla' };
const oaxaca = { id: id(1002), name: 'Oaxaca' };
const tlaxcala = { id: id(1003), name: 'Tlaxcala' };
const longName = (n: number) => `Destino patrimonial número ${n} del corredor turístico de Puebla con nombre muy extenso para probar límites`;
const longDesc = 'Conjunto arquitectónico con fachadas barrocas, patios interiores y colecciones de arte sacro de la región poblana.';
const rec = (n: number, state: { id: string }, name: string, category: string, shortDescription = '') =>
  ({ id: id(n), stateId: state.id, name, shortDescription, categories: [{ category: { name: category } }] });
// Puebla: 32 atractivos (5 categorías) + hospedaje y gastronomía que nunca deben aparecer en itinerarios.
const pueblaRecords = [
  ...Array.from({ length: 32 }, (_, i) => rec(100 + i, puebla, longName(i), CATS[i % CATS.length], longDesc)),
  rec(190, puebla, 'Hotel Centro', 'Hospedaje'), rec(191, puebla, 'Mole poblano', 'Gastronomía'),
];
const oaxacaRecords = [rec(200, oaxaca, 'Monte Albán', 'Arqueológico'), rec(201, oaxaca, 'Templo de Santo Domingo', 'Religioso'),
  rec(202, oaxaca, 'Museo Textil', 'Cultural'), rec(203, oaxaca, 'Hierve el Agua', 'Natural')];
const tlaxcalaRecords = Array.from({ length: 12 }, (_, i) => rec(300 + i, tlaxcala, `Sitio ${i} de Tlaxcala`, CATS[i % CATS.length]));
const all = [...pueblaRecords, ...oaxacaRecords, ...tlaxcalaRecords];
const stateIds = (s: { id: string }) => new Set(all.filter(r => r.stateId === s.id && !['Hospedaje', 'Gastronomía'].includes(r.categories[0].category.name)).map(r => r.id));

let calls: LlmRequest[]; let fetched: string[]; let model: (r: LlmRequest) => string;
const msg = (r: LlmRequest) => JSON.parse(r.message);
const obedient = (r: LlmRequest) => JSON.stringify({ placeIds: msg(r).candidates.map((c: { id: string }) => c.id).slice(0, msg(r).maxPlaceIds) });
beforeEach(() => {
  calls = []; fetched = []; model = obedient;
  jest.spyOn(globalThis, 'fetch').mockImplementation(async url => {
    const u = new URL(String(url));
    if (u.origin !== 'https://catalog.invalid') throw Error('No external network allowed');
    fetched.push(u.pathname + u.search);
    if (u.pathname === '/states') return new Response(JSON.stringify([puebla, oaxaca, tlaxcala]));
    const stateId = u.searchParams.get('stateId');
    // La muestra estatal incluye además registros de OTRO estado: el backend debe descartarlos.
    return new Response(JSON.stringify(stateId ? [...all.filter(r => r.stateId === stateId), rec(999, { id: id(1999) }, 'Intruso de otro estado', 'Cultural')] : all));
  });
});
afterEach(() => jest.restoreAllMocks());
const makeService = (env: Record<string, string> = {}) => {
  const cfg = loadConfig({ GROQ_API_KEY: 'k', MXGUIDE_API_URL: 'https://catalog.invalid', ...env });
  return new ChatService(cfg, [{ name: 'groq', isConfigured: () => true, generate: async r => { calls.push(r); return r.system.includes('selector') ? model(r) : 'Con gusto te ayudo.'; } }], new PlacesService(cfg));
};
const service = () => makeService();
function conversation() {
  const chat = service();
  const history: { role: 'user' | 'assistant'; content: string }[] = [];
  return async (message: string) => {
    calls = [];
    const r = await chat.chat({ message, history: [...history] });
    history.push({ role: 'user', content: message }, { role: 'assistant', content: r.reply });
    return r;
  };
}

describe('Etapa 3 · itinerarios por días (integración)', () => {
  it.each([1, 2, 3, 4, 5, 6, 7])('%i día(s) en Puebla: contrato completo y solo destinos validados del estado', async days => {
    const label = days === 1 ? 'un día' : `${days} días`;
    const r = await service().chat({ message: `Planéame ${label} en Puebla` });
    assertItineraryContract(r, days);
    expect(r.places).toHaveLength(Math.min(days * 3, 21));
    expect(r.places.every(p => stateIds(puebla).has(p.id))).toBe(true);
    expect(r.places.map(p => p.name)).not.toContain('Intruso de otro estado');
    expect(r.code).toBe('found');
    expect(msg(calls[0]).maxPlaceIds).toBe(Math.min(days * 3, 21));
  });

  it('7 días usa hasta 30 candidatos locales del estado (no 15) y 21 paradas', async () => {
    const r = await service().chat({ message: 'Planéame 7 días en Puebla' });
    expect(msg(calls[0]).candidates).toHaveLength(30);
    expect(msg(calls[0]).candidates.every((c: { id: string }) => stateIds(puebla).has(c.id))).toBe(true);
    expect(r.places).toHaveLength(21);
    expect(r.itinerary!.days.map(d => d.placeIds.length)).toEqual([3, 3, 3, 3, 3, 3, 3]);
  });

  it('itinerario sin duración: comportamiento anterior (≤5, 15 candidatos, sin «itinerary» ni días)', async () => {
    const r = await service().chat({ message: 'Arma un itinerario en Puebla' });
    expect(r.kind).toBe('itinerary');
    expect(r.places.length).toBeLessThanOrEqual(5);
    expect(msg(calls[0]).candidates).toHaveLength(15);
    expect(msg(calls[0]).maxPlaceIds).toBe(5);
    expect('itinerary' in r).toBe(false);
    expect(r.reply).not.toContain('**Día');
  });

  it('menos destinos que días: 4 destinos en 7 días, días libres explicados y requestedDays conservado', async () => {
    const r = await service().chat({ message: 'Planéame 7 días en Oaxaca' });
    assertItineraryContract(r, 7);
    expect(r.itinerary!.days).toHaveLength(4);
    expect(r.itinerary!.days.every(d => d.placeIds.length === 1)).toBe(true);
    expect(r.reply).toContain('Encontré 4 destinos para tus 7 días: los últimos 3 días quedan libres para que los planees tú.');
    expect(r).not.toHaveProperty('itinerary.partial');
  });

  it('un solo día libre usa singular', async () => {
    const r = await service().chat({ message: 'Planéame 5 días en Oaxaca' });
    expect(r.reply).toContain('Encontré 4 destinos para tus 5 días: el último día queda libre para que lo planees tú.');
  });

  it('10 destinos en 4 días → 3, 3, 2, 2', async () => {
    model = r => JSON.stringify({ placeIds: msg(r).candidates.map((c: { id: string }) => c.id).slice(0, 10) });
    const r = await service().chat({ message: 'Planéame 4 días en Puebla' });
    assertItineraryContract(r, 4);
    expect(r.itinerary!.days.map(d => d.placeIds.length)).toEqual([3, 3, 2, 2]);
  });

  it.each([
    ['excede el máximo', (r: LlmRequest) => JSON.stringify({ placeIds: msg(r).candidates.map((c: { id: string }) => c.id).slice(0, msg(r).maxPlaceIds + 1) })],
    ['ID inexistente', () => JSON.stringify({ placeIds: [id(100), id(424242)] })],
    ['ID de otro estado', () => JSON.stringify({ placeIds: [id(100), id(200)] })],
    ['ID duplicado', () => JSON.stringify({ placeIds: [id(100), id(100)] })],
    ['texto libre', () => 'Te recomiendo la Catedral y un tour de 3 horas'],
  ])('selección inválida (%s): fallback determinista, válido y sin romper la petición', async (_case, bad) => {
    model = bad;
    const first = await service().chat({ message: 'Planéame 2 días en Puebla' });
    const second = await service().chat({ message: 'Planéame 2 días en Puebla' });
    expect(first.code).toBe('selection-fallback');
    assertItineraryContract(first, 2);
    expect(first.places).toHaveLength(6);
    expect(first.places.every(p => stateIds(puebla).has(p.id))).toBe(true);
    expect(first.places.map(p => p.id)).toEqual(second.places.map(p => p.id));
    expect(first.itinerary).toEqual(second.itinerary);
  });

  it('el fallback queda registrado en el diagnóstico', async () => {
    const logs: string[] = [];
    jest.spyOn(Logger.prototype, 'log').mockImplementation(function (m: unknown) { logs.push(String(m)); });
    model = () => 'no es JSON';
    await makeService({ LOG_LEVEL: 'log' }).chat({ message: 'Planéame 3 días en Puebla' });
    expect(JSON.parse(logs[0].replace(/^chat /, ''))).toMatchObject({ code: 'selection-fallback', itinerary: true, itineraryDays: 3, plannedDays: 3, selected: 9 });
  });

  it('selección vacía del modelo: kind empty, sin itinerary (contrato anterior)', async () => {
    model = () => JSON.stringify({ placeIds: [] });
    const r = await service().chat({ message: 'Planéame 3 días en Puebla' });
    expect(r).toMatchObject({ kind: 'empty', code: 'selection-empty', places: [] });
    expect('itinerary' in r).toBe(false);
  });

  it('distribución determinista: misma respuesta del modelo, mismo plan', async () => {
    const a = await service().chat({ message: 'Planéame 5 días en Tlaxcala' });
    const b = await service().chat({ message: 'Planéame 5 días en Tlaxcala' });
    expect(a.itinerary).toEqual(b.itinerary);
    expect(a.places).toEqual(b.places);
  });

  it('alterna categorías dentro de cada día cuando hay variedad', async () => {
    const r = await service().chat({ message: 'Planéame 3 días en Tlaxcala' });
    for (const day of r.itinerary!.days) {
      const cats = day.placeIds.map(pid => r.places.find(p => p.id === pid)!.category);
      for (let i = 1; i < cats.length; i++) expect(cats[i]).not.toBe(cats[i - 1]);
    }
  });

  it('21 destinos con nombres y descripciones largos: reply ≤ presupuesto y cabe en un turno de historial (4000)', async () => {
    const r = await service().chat({ message: 'Planéame 7 días en Puebla' });
    expect(r.places).toHaveLength(21);
    expect(r.reply.length).toBeLessThanOrEqual(ITINERARY_REPLY_BUDGET);
    expect(r.reply.length).toBeLessThanOrEqual(4000);
    assertItineraryContract(r, 7);
  });
});

describe('Etapa 4 · compatibilidad del contrato', () => {
  const base = ['code', 'format', 'kind', 'places', 'provider', 'reply', 'suggestions'];
  it.each([
    'Hola', '¿Qué lugares hay en Puebla?', 'Itinerario en Puebla', 'Itinerario de 10 días en Puebla',
    'Itinerario de comida en Puebla', 'Itinerario', 'Lugares cerca de mí', '¿Qué playas puedo visitar en Tlaxcala?',
  ])('sin «itinerary»: %s', async message => {
    const r = await service().chat({ message });
    expect(Object.keys(r).sort()).toEqual(base);
  });

  it('con duración reconocida: exactamente una llave adicional', async () => {
    const r = await service().chat({ message: 'Planéame 2 días en Puebla' });
    expect(Object.keys(r).sort()).toEqual([...base, 'itinerary'].sort());
  });

  it('JSON serializado: «itinerary» ausente (no null) en respuestas sin duración', async () => {
    const r = await service().chat({ message: '¿Qué lugares hay en Puebla?' });
    expect(JSON.parse(JSON.stringify(r))).not.toHaveProperty('itinerary');
  });
});

describe('Seguimientos con itinerarios largos', () => {
  it('previousRecommendationIds reconoce listas numeradas de hasta 21 (dos dígitos) y omite «**Día N**»', () => {
    const cands = Array.from({ length: 21 }, (_, i) => ({ id: id(i + 1), name: `Sitio ${i + 1}`, state: 'Puebla', category: '', description: '' }));
    const reply = 'Itinerario:\n\n' + [0, 1, 2, 3, 4, 5, 6].map(d => `**Día ${d + 1}**\n\n` + [0, 1, 2].map(k => `${d * 3 + k + 1}. **Sitio ${d * 3 + k + 1}**`).join('\n')).join('\n\n');
    const ids = previousRecommendationIds([{ role: 'user', content: 'x' }, { role: 'assistant', content: reply }], cands);
    expect(ids && [...ids].length).toBe(21);
  });

  it('más de 21 líneas no se interpreta (no es una respuesta de Mictlán)', () => {
    const cands = [{ id: id(1), name: 'Sitio 1', state: '', category: '', description: '' }];
    const reply = Array.from({ length: 22 }, (_, i) => `${i + 1}. **Sitio ${i + 1}**`).join('\n');
    expect(previousRecommendationIds([{ role: 'user', content: 'x' }, { role: 'assistant', content: reply }], cands)).toBeNull();
  });

  it('historiales anteriores (listas «- » y 1–5 numeradas, escapes v1) siguen funcionando', () => {
    const cands = [{ id: id(1), name: 'Museo *Amparo*', state: '', category: '', description: '' }, { id: id(2), name: 'Fuerte', state: '', category: '', description: '' }];
    const old = 'Intro:\n- Museo \\*Amparo\\*: texto\n2. **Fuerte**';
    expect([...previousRecommendationIds([{ role: 'user', content: 'x' }, { role: 'assistant', content: old }], cands)!]).toEqual([id(1), id(2)]);
  });

  it('«¿Qué más?» tras un itinerario de 7 paradas no repite ninguna', async () => {
    const say = conversation();
    const first = await say('Planéame 2 días en Tlaxcala');
    expect(first.places).toHaveLength(6);
    const more = await say('¿Qué más?');
    assertItineraryContract(more, 2);
    const shown = new Set(first.places.map(p => p.id));
    expect(more.places.some(p => shown.has(p.id))).toBe(false);
    expect(more.places.every(p => stateIds(tlaxcala).has(p.id))).toBe(true);
  });

  it('«¿Qué más?» tras 21 paradas en Puebla: excluye las 21 y continúa en Puebla', async () => {
    const say = conversation();
    const first = await say('Planéame 7 días en Puebla');
    const more = await say('¿Qué más?');
    const shown = new Set(first.places.map(p => p.id));
    expect(more.places.length).toBeGreaterThan(0);
    expect(more.places.some(p => shown.has(p.id))).toBe(false);
    expect(more.places.every(p => stateIds(puebla).has(p.id))).toBe(true);
  });

  it('«de esos» sobre una lista de más de 5 paradas', async () => {
    const say = conversation();
    const first = await say('Planéame 3 días en Tlaxcala');
    expect(first.places.length).toBeGreaterThan(5);
    const r = await say('¿Cuáles de esos son arqueológicos?');
    const shown = new Set(first.places.map(p => p.id));
    expect(r.places.length).toBeGreaterThan(0);
    expect(r.places.every(p => shown.has(p.id) && p.category === 'Arqueológico')).toBe(true);
  });

  it('cambio de estado redistribuye en el nuevo estado y conserva la duración', async () => {
    const say = conversation();
    await say('Planéame 3 días en Puebla');
    const r = await say('¿Y en Tlaxcala?');
    assertItineraryContract(r, 3);
    expect(r.places.every(p => stateIds(tlaxcala).has(p.id))).toBe(true);
  });

  it('cambio de duración redistribuye: 3 días (9) → 2 días (6) → 7 días (Tlaxcala: 12 → 7 días con días equilibrados)', async () => {
    const say = conversation();
    const three = await say('Planéame 3 días en Tlaxcala');
    assertItineraryContract(three, 3);
    expect(three.places).toHaveLength(9);
    const two = await say('Mejor que sean 2 días');
    assertItineraryContract(two, 2);
    expect(two.places).toHaveLength(6);
    expect(two.reply).toMatch(/^Itinerario sugerido para conocer Tlaxcala en 2 días:/);
    const seven = await say('Mejor que sean 7 días');
    assertItineraryContract(seven, 7);
    expect(seven.itinerary!.days.map(d => d.placeIds.length)).toEqual([2, 2, 2, 2, 2, 1, 1]);
  });

  it('el historial con un itinerario de 21 paradas se acepta en la siguiente petición (≤ 4000 por turno)', async () => {
    const say = conversation();
    const first = await say('Planéame 7 días en Puebla');
    expect(first.reply.length).toBeLessThanOrEqual(4000);
    await expect(say('Mejor que sean 2 días')).resolves.toMatchObject({ kind: 'itinerary' });
  });
});
