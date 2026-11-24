import { Logger } from '@nestjs/common';
import { ChatResponse, ChatService } from '../src/chat/chat.service';
import { PlacesService } from '../src/places/places.service';
import { LlmRequest } from '../src/chat/providers/llm-provider';
import { loadConfig } from '../src/config/env';
import { additionRequest, directItinerary, durationChange, extractDuration, foodItinerary, itineraryContext, moreRequest } from '../src/places/itinerary';

/** Itinerarios — etapa 1 (detección y duración) y etapa 2 (contexto y seguimiento). */
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const puebla = { id: id(1), name: 'Puebla' };
const oaxaca = { id: id(2), name: 'Oaxaca' };
const rec = (n: number, state: { id: string }, name: string, category: string) =>
  ({ id: id(100 + n), stateId: state.id, name, shortDescription: '', categories: [{ category: { name: category } }] });
const catalog = [
  rec(0, puebla, 'Catedral de Puebla', 'Religioso'), rec(1, puebla, 'Fuerte de Loreto', 'Histórico'),
  rec(2, puebla, 'Museo Amparo', 'Cultural'), rec(3, puebla, 'Museo del Barroco', 'Cultural'),
  rec(4, puebla, 'Cantona', 'Arqueológico'), rec(5, puebla, 'Cuetzalan', 'Natural'),
  rec(6, puebla, 'Casa del Alfeñique', 'Histórico'), rec(7, puebla, 'Hotel Centro Puebla', 'Hospedaje'),
  rec(8, puebla, 'Mole poblano', 'Gastronomía'),
  rec(20, oaxaca, 'Monte Albán', 'Arqueológico'), rec(21, oaxaca, 'Templo de Santo Domingo', 'Religioso'),
  rec(22, oaxaca, 'Museo Textil de Oaxaca', 'Cultural'), rec(23, oaxaca, 'Hierve el Agua', 'Natural'),
];
const inState = (s: { id: string }) => new Set(catalog.filter(p => p.stateId === s.id).map(p => p.id));

let calls: LlmRequest[]; let fetched: string[];
beforeEach(() => {
  calls = []; fetched = [];
  jest.spyOn(globalThis, 'fetch').mockImplementation(async url => {
    const u = new URL(String(url));
    if (u.origin !== 'https://catalog.invalid') throw Error('No external network allowed');
    fetched.push(u.pathname + u.search);
    if (u.pathname === '/states') return new Response(JSON.stringify([puebla, oaxaca]));
    const stateId = u.searchParams.get('stateId');
    return new Response(JSON.stringify(stateId ? catalog.filter(p => p.stateId === stateId) : catalog));
  });
});
afterEach(() => jest.restoreAllMocks());

const makeService = (env: Record<string, string> = {}) => {
  const cfg = loadConfig({ GROQ_API_KEY: 'k', MXGUIDE_API_URL: 'https://catalog.invalid', ...env });
  return new ChatService(cfg, [{
    name: 'groq', isConfigured: () => true,
    generate: async r => { calls.push(r); return r.system.includes('selector') ? JSON.stringify({ placeIds: JSON.parse(r.message).candidates.map((p: { id: string }) => p.id).slice(0, JSON.parse(r.message).maxPlaceIds ?? 5) }) : 'Con gusto te ayudo.'; },
  }], new PlacesService(cfg));
};
const service = () => makeService();

/** Conversación que acumula historial como lo hace Flutter (reply original como turno assistant). */
function conversation() {
  const chat = service();
  const history: { role: 'user' | 'assistant'; content: string }[] = [];
  return async (message: string): Promise<ChatResponse> => {
    calls = [];
    const r = await chat.chat({ message, history: [...history] });
    history.push({ role: 'user', content: message }, { role: 'assistant', content: r.reply });
    return r;
  };
}
const allIn = (r: ChatResponse, s: { id: string }) => r.places.every(p => inState(s).has(p.id));

describe('Etapa 1 · detección de itinerarios', () => {
  it.each([
    ['Planea mi viaje a Puebla', puebla],
    ['Planéame 2 días en Puebla', puebla],
    ['¿Qué puedo hacer 3 días en Oaxaca?', oaxaca],
    ['Ruta por Puebla', puebla],
    ['Organízame un fin de semana en Puebla', puebla],
    ['Quiero recorrer Puebla durante un día', puebla],
  ])('nueva expresión: «%s»', async (message, state) => {
    const r = await service().chat({ message });
    expect(r).toMatchObject({ kind: 'itinerary', code: 'found' });
    expect(r.reply).toMatch(/^Itinerario sugerido para conocer /);
    expect(r.places.length).toBeGreaterThan(0);
    expect(allIn(r, state)).toBe(true);
  });

  it.each(['Itinerario en Puebla', 'Quiero un recorrido por Oaxaca', 'Hazme un plan para Puebla', 'Arma un itinerario en Puebla', 'Prepárame un plan para visitar Puebla'])(
    'se conserva la detección existente: «%s»', message => expect(directItinerary(message)).toBe(true));

  it.each(['¿Qué lugares hay en Puebla?', '¿Qué clima hace en 3 días?', 'Hola', 'Recomiéndame museos en Puebla', 'Llego en 2 días, ¿qué llevo?', '¿Qué playas hay en Puebla?'])(
    'no se confunde con itinerario: «%s»', message => expect(directItinerary(message)).toBe(false));

  it('recomendaciones normales siguen siendo recommendation', async () => {
    expect((await service().chat({ message: '¿Qué lugares hay en Puebla?' })).kind).toBe('recommendation');
  });
});

describe('Etapa 1 · duración', () => {
  it.each([
    ['1 día en Puebla', 1], ['un día en Puebla', 1], ['2 días', 2], ['dos días', 2], ['tres dias', 3], ['4 días', 4],
    ['cinco días', 5], ['6 días', 6], ['siete días', 7], ['7 dias', 7],
    ['fin de semana', 2], ['un fin de semana en Puebla', 2],
    ['Quiero recorrer Puebla durante un día', 1], ['un día completo en Oaxaca', 1], ['todo el día en Puebla', 1],
  ])('«%s» → %i días', (message, days) => expect(extractDuration(message)).toEqual({ days }));

  it.each(['Itinerario en Puebla', 'Planea mi viaje a Puebla', 'Ruta por Puebla', 'un día de estos voy', 'algún día iré a Puebla', 'cuántos días necesito'])(
    'sin duración explícita no se inventa: «%s»', message => expect(extractDuration(message).days).toBeUndefined());

  it.each(['10 días en Puebla', 'itinerario de 15 dias', 'ocho días'])('fuera de rango (>7): «%s»', message =>
    expect(extractDuration(message)).toEqual({ outOfRange: true }));

  it('0 días no es una duración', () => expect(extractDuration('0 días')).toEqual({}));

  it('la duración aparece en el título y se reparte por día, sin horarios ni datos operativos', async () => {
    const r = await service().chat({ message: 'Planéame 3 días en Puebla' });
    expect(r.reply).toMatch(/^Itinerario sugerido para conocer Puebla en 3 días:/);
    expect(r.reply).toContain('**Día 1**');
    expect(r.itinerary?.requestedDays).toBe(3);
    expect(r.reply).not.toMatch(/\b\d{1,2}:\d{2}\b|minutos|km\b|\$/);
  });

  it('un día y fin de semana', async () => {
    expect((await service().chat({ message: 'Quiero recorrer Puebla durante un día' })).reply).toMatch(/^Itinerario sugerido para conocer Puebla en un día:/);
    expect((await service().chat({ message: 'Organízame un fin de semana en Puebla' })).reply).toMatch(/^Itinerario sugerido para conocer Puebla en 2 días:/);
  });

  it('sin duración: no se menciona ninguna y se invita a indicarla', async () => {
    const r = await service().chat({ message: 'Itinerario en Puebla' });
    expect(r.reply).toMatch(/^Itinerario sugerido para conocer Puebla:/);
    expect(r.reply).toContain('Si me dices cuántos días tienes (de 1 a 7)');
  });

  it('fuera de rango: aviso que pide 1–7 días, sin lista, sin IA y sin duración inventada', async () => {
    const r = await service().chat({ message: 'Itinerario de 10 días en Puebla' });
    expect(r).toMatchObject({ kind: 'notice', code: 'itinerary-days-out-of-range', places: [] });
    expect(r.reply).toContain('Puedo preparar itinerarios de 1 a 7 días');
    expect(r.reply).toContain('Puebla');
    expect(calls).toHaveLength(0);
    expect('itinerary' in r).toBe(false);
  });
});

describe('Etapa 1 · itinerarios gastronómicos bloqueados', () => {
  it.each([
    'Itinerario de comida en Puebla', 'Planea un viaje para comer en Puebla', 'Itinerario de restaurantes en Puebla',
    'Ruta de antojitos por Puebla', 'itinerario gastronómico en Puebla', 'Recorrido de sabores por Puebla', 'Planéame 2 días de comida típica en Puebla',
  ])('«%s» → aviso sin IA ni platillos como paradas', async message => {
    const r = await service().chat({ message });
    expect(r).toMatchObject({ kind: 'notice', code: 'itinerary-food-unverified', places: [] });
    expect(calls).toHaveLength(0);
  });

  it('fuera de itinerarios, «comida» no bloquea recomendaciones', () => {
    expect(foodItinerary('comida típica de Puebla')).toBe(true);
    expect(directItinerary('comida típica de Puebla')).toBe(false);
  });
});

describe('Etapa 2 · seguimiento del itinerario', () => {
  it('«¿Y en Oaxaca?» cambia el estado, conserva el modo itinerario y la duración', async () => {
    const say = conversation();
    await say('Arma un itinerario de 3 días en Puebla');
    const r = await say('¿Y en Oaxaca?');
    expect(r.kind).toBe('itinerary');
    expect(r.reply).toMatch(/^Itinerario sugerido para conocer Oaxaca en 3 días:/);
    expect(allIn(r, oaxaca)).toBe(true);
  });

  it('«¿Y uno cultural?» conserva el estado y cambia la intención', async () => {
    const say = conversation();
    await say('Arma un itinerario de 3 días en Puebla');
    const r = await say('¿Y uno cultural?');
    expect(r.kind).toBe('itinerary');
    expect(r.places.map(p => p.name).sort()).toEqual(['Museo Amparo', 'Museo del Barroco']);
    expect(JSON.parse(calls[0].message).intent).toBe('culture');
  });

  it('«Mejor que sean 2 días» actualiza la duración sin perder estado ni modo', async () => {
    const say = conversation();
    await say('Arma un itinerario de 3 días en Puebla');
    const r = await say('Mejor que sean 2 días');
    expect(r.kind).toBe('itinerary');
    expect(r.reply).toMatch(/^Itinerario sugerido para conocer Puebla en 2 días:/);
    expect(allIn(r, puebla)).toBe(true);
  });

  it.each(['Mejor que sean 2 días', 'Ahora solo un día', 'mejor un fin de semana'])('cambio de duración reconocido: «%s»', m => expect(durationChange(m)).toBe(true));

  it('«Agrega un museo» conserva estado y modo, ajusta la intención a museos y no mezcla estados', async () => {
    const say = conversation();
    await say('Arma un itinerario de 3 días en Puebla');
    const r = await say('Agrega un museo');
    expect(r.kind).toBe('itinerary');
    expect(r.reply).toMatch(/^Itinerario sugerido para conocer Puebla en 3 días:/);
    expect(r.places.map(p => p.name).sort()).toEqual(['Museo Amparo', 'Museo del Barroco']);
    expect(allIn(r, puebla)).toBe(true);
    expect(fetched.some(p => p.startsWith('/places/featured'))).toBe(false);
  });

  it.each(['Agrega un museo', 'Añade algo cultural', 'Incluye una iglesia'])('adición reconocida: «%s»', m => expect(additionRequest(m)).toBe(true));

  it('«¿Qué más?» continúa el itinerario en el mismo estado sin repetir paradas', async () => {
    const say = conversation();
    const first = await say('Arma un itinerario de un día en Puebla');
    expect(first.places).toHaveLength(3);
    const r = await say('¿Qué más?');
    expect(r.kind).toBe('itinerary');
    expect(allIn(r, puebla)).toBe(true);
    const shown = new Set(first.places.map(p => p.id));
    expect(r.places.length).toBeGreaterThan(0);
    expect(r.places.some(p => shown.has(p.id))).toBe(false);
  });

  it('«¿Qué más?» tras un itinerario que ya mostró todos los atractivos del estado: exhausted', async () => {
    const say = conversation();
    const first = await say('Arma un itinerario de 3 días en Puebla');
    expect(first.places).toHaveLength(7); // 7 atractivos en el catálogo de prueba (≤ 9 = 3 × 3)
    expect(await say('¿Qué más?')).toMatchObject({ kind: 'notice', code: 'exhausted', places: [] });
  });

  it('«¿Qué más?» cuando ya se mostró todo: aviso exhausted en el mismo estado', async () => {
    const say = conversation();
    await say('Arma un itinerario en Oaxaca');
    const r = await say('¿Qué más?');
    expect(r).toMatchObject({ kind: 'notice', code: 'exhausted', places: [] });
    expect(r.reply).toContain('de Oaxaca');
  });

  it.each(['¿Qué más?', '¿Y qué más?', 'qué otros', 'algo más', 'dame más'])('continuación reconocida: «%s»', m => expect(moreRequest(m)).toBe(true));

  it('cadena completa: 3 días Puebla → Oaxaca → 2 días → museo, siempre Oaxaca y 2 días', async () => {
    const say = conversation();
    await say('Arma un itinerario de 3 días en Puebla');
    expect(allIn(await say('¿Y en Oaxaca?'), oaxaca)).toBe(true);
    const twoDays = await say('Mejor que sean 2 días');
    expect(twoDays.reply).toMatch(/^Itinerario sugerido para conocer Oaxaca en 2 días:/);
    const museum = await say('Agrega un museo');
    expect(museum.kind).toBe('itinerary');
    expect(museum.reply).toMatch(/^Itinerario sugerido para conocer Oaxaca en 2 días:/);
    expect(museum.places.map(p => p.name)).toEqual(['Museo Textil de Oaxaca']);
  });

  it('sin itinerario previo, «Mejor que sean 2 días» es conversación y no busca', async () => {
    const r = await service().chat({ message: 'Mejor que sean 2 días' });
    expect(r.kind).toBe('conversation');
    expect(fetched).toEqual([]);
  });

  it('una conversación intermedia corta la cadena del itinerario', () => {
    const ctx = itineraryContext('¿Qué más?', [
      { role: 'user', content: 'Itinerario de 3 días en Puebla' }, { role: 'assistant', content: '1. **Catedral de Puebla**' },
      { role: 'user', content: 'Gracias, ¿qué ropa llevo?' }, { role: 'assistant', content: 'Ropa ligera.' },
    ]);
    expect(ctx.itinerary).toBe(false);
    expect(ctx.duration).toEqual({});
  });

  it('el itinerario sigue sin enviar historial a la IA', async () => {
    const say = conversation();
    await say('Arma un itinerario de 3 días en Puebla');
    await say('Mejor que sean 2 días');
    expect(calls[0].history).toEqual([]);
    expect(calls[0].message).not.toContain('Arma un itinerario');
  });

  it('peticiones normales tras un itinerario no heredan el modo', async () => {
    const say = conversation();
    await say('Arma un itinerario de 3 días en Puebla');
    expect((await say('¿Qué lugares culturales hay en Oaxaca?')).kind).toBe('recommendation');
  });
});

describe('Etapa 2 · «¿qué más?» en recomendaciones normales', () => {
  it('conserva el estado, no repite y no pasa a itinerario', async () => {
    const say = conversation();
    const first = await say('¿Qué lugares hay en Puebla?');
    const r = await say('¿Qué más?');
    expect(r.kind).toBe('recommendation');
    expect(allIn(r, puebla)).toBe(true);
    const shown = new Set(first.places.map(p => p.id));
    expect(r.places.some(p => shown.has(p.id))).toBe(false);
  });
});

describe('Compatibilidad, contrato y diagnóstico', () => {
  it('mismas llaves del contrato y coherencia kind/code', async () => {
    for (const m of ['Planéame 2 días en Puebla', 'Itinerario de comida en Puebla', 'Itinerario de 10 días en Puebla']) {
      const r = await service().chat({ message: m });
      // Solo el itinerario con duración reconocida agrega la llave opcional «itinerary» (etapa 4).
      const extra = m.startsWith('Planéame') ? ['itinerary'] : [];
      expect(Object.keys(r).sort()).toEqual(['code', 'format', 'kind', 'places', 'provider', 'reply', 'suggestions', ...extra].sort());
      if (r.places.length) expect(r.code).toBe('found'); else expect(r.code).not.toBe('found');
    }
  });

  it('IDs fuera de la lista blanca siguen rechazados en itinerarios', async () => {
    const cfg = loadConfig({ GROQ_API_KEY: 'k', MXGUIDE_API_URL: 'https://catalog.invalid' });
    const bad = new ChatService(cfg, [{ name: 'groq', isConfigured: () => true, generate: async () => JSON.stringify({ placeIds: [id(120)] }) }], new PlacesService(cfg));
    const r = await bad.chat({ message: 'Planéame 2 días en Puebla' });
    expect(r.code).toBe('selection-fallback');
    expect(allIn(r, puebla)).toBe(true);
  });

  it('el diagnóstico registra modo itinerario y días, sin el mensaje', async () => {
    const logs: string[] = [];
    jest.spyOn(Logger.prototype, 'log').mockImplementation(function (m: unknown) { logs.push(String(m)); });
    await makeService({ LOG_LEVEL: 'log' }).chat({ message: 'Planéame 2 días en Puebla' });
    expect(JSON.parse(logs[0].replace(/^chat /, ''))).toMatchObject({ itinerary: true, itineraryDays: 2, kind: 'itinerary' });
    expect(logs[0]).not.toContain('Planéame');
  });
});
