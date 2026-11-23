import { ChatResponse, ChatService } from '../src/chat/chat.service';
import { PlacesService } from '../src/places/places.service';
import { LlmRequest } from '../src/chat/providers/llm-provider';
import { loadConfig } from '../src/config/env';
import { bareDuration, extractDuration, itineraryContext, stateChangeRequest, stripLeadIns } from '../src/places/itinerary';

/** Seguimientos de itinerario con muletillas, duraciones aisladas y más de 7 días. */
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const puebla = { id: id(1), name: 'Puebla' };
const oaxaca = { id: id(2), name: 'Oaxaca' };
const CATS = ['Histórico', 'Cultural', 'Arqueológico', 'Natural', 'Religioso'];
const rec = (n: number, state: { id: string }, name: string, category: string) =>
  ({ id: id(n), stateId: state.id, name, shortDescription: '', categories: [{ category: { name: category } }] });
const catalog = [
  ...Array.from({ length: 20 }, (_, i) => rec(100 + i, puebla, `Sitio poblano ${i}`, CATS[i % CATS.length])),
  rec(190, puebla, 'Hotel Centro', 'Hospedaje'),
  ...Array.from({ length: 6 }, (_, i) => rec(200 + i, oaxaca, `Sitio oaxaqueño ${i}`, CATS[i % CATS.length])),
];
const inState = (s: { id: string }) => new Set(catalog.filter(r => r.stateId === s.id).map(r => r.id));

let calls: LlmRequest[]; let fetched: string[];
beforeEach(() => {
  calls = []; fetched = [];
  jest.spyOn(globalThis, 'fetch').mockImplementation(async url => {
    const u = new URL(String(url));
    if (u.origin !== 'https://catalog.invalid') throw Error('No external network allowed');
    fetched.push(u.pathname + u.search);
    if (u.pathname === '/states') return new Response(JSON.stringify([puebla, oaxaca]));
    const stateId = u.searchParams.get('stateId');
    return new Response(JSON.stringify(stateId ? catalog.filter(r => r.stateId === stateId) : catalog));
  });
});
afterEach(() => jest.restoreAllMocks());

const service = () => {
  const cfg = loadConfig({ GROQ_API_KEY: 'k', MXGUIDE_API_URL: 'https://catalog.invalid' });
  return new ChatService(cfg, [{
    name: 'groq', isConfigured: () => true,
    generate: async r => {
      calls.push(r);
      if (!r.system.includes('selector')) return 'Con gusto te ayudo.';
      const m = JSON.parse(r.message);
      return JSON.stringify({ placeIds: m.candidates.map((c: { id: string }) => c.id).slice(0, m.maxPlaceIds) });
    },
  }], new PlacesService(cfg));
};

/** Conversación que reenvía el historial como Flutter/Postman (reply original como turno assistant). */
function conversation() {
  const chat = service();
  const history: { role: 'user' | 'assistant'; content: string }[] = [];
  return async (message: string): Promise<ChatResponse> => {
    calls = []; fetched = [];
    const r = await chat.chat({ message, history: [...history] });
    history.push({ role: 'user', content: message }, { role: 'assistant', content: r.reply });
    return r;
  };
}

function assertPlanned(r: ChatResponse, days: number, state: { id: string; name: string }) {
  expect(r.kind).toBe('itinerary');
  expect(r.reply).toMatch(new RegExp(`^Itinerario sugerido para conocer ${state.name} en ${days === 1 ? 'un día' : days + ' días'}:`));
  expect(r.itinerary?.requestedDays).toBe(days);
  const flat = r.itinerary!.days.flatMap(d => d.placeIds);
  expect(flat).toEqual(r.places.map(p => p.id));
  expect(new Set(flat).size).toBe(flat.length);
  expect(r.places.every(p => inState(state).has(p.id))).toBe(true);
}

const PREVIOUS = 'Arma un itinerario de 3 días en Puebla';
const DURATION_VARIANTS = ['Perdón, mejor de solo 5 días', 'No, mejor 5 días', 'Oye, mejor que sean 5 días', 'Ok, entonces 5 días', '5 días'];

describe('Con itinerario previo (3 días en Puebla)', () => {
  it.each(DURATION_VARIANTS)('«%s» cambia a 5 días y conserva Puebla', async message => {
    const say = conversation();
    await say(PREVIOUS);
    const r = await say(message);
    assertPlanned(r, 5, puebla);
    expect(r.places).toHaveLength(15);
  });

  it('«Bueno, agrega un museo» conserva estado, duración y modo, con intención cultural', async () => {
    const say = conversation();
    await say(PREVIOUS);
    const r = await say('Bueno, agrega un museo');
    assertPlanned(r, 3, puebla);
    expect(r.places.every(p => p.category === 'Cultural')).toBe(true);
    expect(JSON.parse(calls[0].message).intent).toBe('culture');
  });

  it('«Oye, ¿qué más hay?» continúa en Puebla sin repetir los destinos ya mostrados', async () => {
    const say = conversation();
    const first = await say(PREVIOUS);
    const r = await say('Oye, ¿qué más hay?');
    assertPlanned(r, 3, puebla);
    const shown = new Set(first.places.map(p => p.id));
    expect(r.places.length).toBeGreaterThan(0);
    expect(r.places.some(p => shown.has(p.id))).toBe(false);
  });

  it('«No, mejor en Oaxaca» cambia de estado y conserva duración y modo', async () => {
    const say = conversation();
    await say(PREVIOUS);
    const r = await say('No, mejor en Oaxaca');
    assertPlanned(r, 3, oaxaca);
  });

  it('variantes adicionales de muletillas: «Disculpa, mejor 2 días», «Mmm, sí, solo 2 días», «Ah, entonces que sean 2 días»', async () => {
    for (const message of ['Disculpa, mejor 2 días', 'Mmm, sí, solo 2 días', 'Ah, entonces que sean 2 días', 'Bueno, mejor dicho 2 días']) {
      const say = conversation();
      await say(PREVIOUS);
      assertPlanned(await say(message), 2, puebla);
    }
  });

  it('«una semana» como duración aislada equivale a 7 días', async () => {
    const say = conversation();
    await say(PREVIOUS);
    assertPlanned(await say('Mejor una semana'), 7, puebla);
  });

  it('una corrección encadenada con muletillas sigue el itinerario: 3 días → «No, mejor en Oaxaca» → «Perdón, mejor 2 días»', async () => {
    const say = conversation();
    await say(PREVIOUS);
    assertPlanned(await say('No, mejor en Oaxaca'), 3, oaxaca);
    assertPlanned(await say('Perdón, mejor 2 días'), 2, oaxaca);
  });
});

describe('Sin itinerario previo: sin falsos positivos', () => {
  it.each(DURATION_VARIANTS)('«%s» sin contexto es conversación y no consulta el catálogo', async message => {
    const r = await service().chat({ message });
    expect(r.kind).toBe('conversation');
    expect(fetched).toEqual([]);
  });

  it.each(DURATION_VARIANTS)('«%s» tras una charla no relacionada sigue siendo conversación', async message => {
    const r = await service().chat({ message, history: [{ role: 'user', content: 'Hola' }, { role: 'assistant', content: 'Hola, ¿a dónde vamos?' }] });
    expect(r.kind).toBe('conversation');
    expect(fetched.filter(p => p.startsWith('/places'))).toEqual([]);
  });

  it.each(DURATION_VARIANTS)('«%s» tras una recomendación normal (no itinerario) no activa un itinerario', async message => {
    const say = conversation();
    await say('¿Qué lugares hay en Puebla?');
    const r = await say(message);
    expect(r.kind).not.toBe('itinerary');
    expect(fetched.filter(p => p.startsWith('/places'))).toEqual([]);
  });

  it('«Bueno, agrega un museo» sin contexto no es itinerario', async () => {
    const r = await service().chat({ message: 'Bueno, agrega un museo' });
    expect(r.kind).not.toBe('itinerary');
    expect('itinerary' in r).toBe(false);
  });

  it('«Oye, ¿qué más hay?» sin contexto es conversación y no busca lugares', async () => {
    const r = await service().chat({ message: 'Oye, ¿qué más hay?' });
    expect(r.kind).toBe('conversation');
    expect(fetched.filter(p => p.startsWith('/places'))).toEqual([]);
  });

  it('«No, mejor en Oaxaca» sin contexto no es itinerario (consulta normal del estado mencionado)', async () => {
    const r = await service().chat({ message: 'No, mejor en Oaxaca' });
    expect(r.kind).not.toBe('itinerary');
    expect('itinerary' in r).toBe(false);
    expect(r.places.every(p => inState(oaxaca).has(p.id))).toBe(true);
  });

  it('una negación real sin coma sigue pidiendo aclaración (no se trata como muletilla)', async () => {
    const r = await service().chat({ message: 'No quiero museos en Puebla' });
    expect(r.kind).toBe('notice');
    expect(['ambiguous', 'intent-ambiguous']).toContain(r.code);
  });

  it('una charla intermedia corta la cadena: itinerario → «Gracias, ¿qué ropa llevo?» → «5 días» es conversación', async () => {
    const say = conversation();
    await say(PREVIOUS);
    expect((await say('Gracias, ¿qué ropa llevo?')).kind).toBe('conversation');
    const r = await say('5 días');
    expect(r.kind).toBe('conversation');
    expect(fetched.filter(p => p.startsWith('/places'))).toEqual([]);
  });
});

describe('Más de 7 días', () => {
  it('«Itinerario de 10 días en Puebla» pide 1–7 días: aviso, sin lista, sin IA ni «itinerary»', async () => {
    const r = await service().chat({ message: 'Itinerario de 10 días en Puebla' });
    expect(r).toMatchObject({ kind: 'notice', code: 'itinerary-days-out-of-range', places: [] });
    expect(r.reply).toBe('Puedo preparar itinerarios de 1 a 7 días. ¿Cuántos días quieres para conocer Puebla? Responde con un número del 1 al 7.');
    expect(calls).toHaveLength(0);
    expect('itinerary' in r).toBe(false);
  });

  it.each(['Perdón, mejor 5 días', '5 días', 'Ok, entonces 5 días', 'Mejor de solo 5 días'])('10 días → «%s» continúa en Puebla con 5 días', async message => {
    const say = conversation();
    await say('Itinerario de 10 días en Puebla');
    assertPlanned(await say(message), 5, puebla);
  });

  it('10 días → otra duración fuera de rango vuelve a pedir 1–7 → «Perdón, mejor 5 días» continúa', async () => {
    const say = conversation();
    await say('Itinerario de 10 días en Puebla');
    expect((await say('No, mejor 12 días')).code).toBe('itinerary-days-out-of-range');
    assertPlanned(await say('Perdón, mejor 5 días'), 5, puebla);
  });

  it('dos semanas también pide 1–7; sin estado se pregunta primero el estado', async () => {
    expect((await service().chat({ message: 'Itinerario de dos semanas en Puebla' })).code).toBe('itinerary-days-out-of-range');
    expect((await service().chat({ message: 'Itinerario de 10 días' })).code).toBe('itinerary-missing-state');
  });
});

describe('Unidades', () => {
  it.each([
    ['Perdón, mejor de solo 5 días', 'mejor de solo 5 dias'], ['No, mejor 5 días', 'mejor 5 dias'], ['Oye, mejor que sean 5 días', 'mejor que sean 5 dias'],
    ['Ok, entonces 5 días', '5 dias'], ['Bueno, agrega un museo', 'agrega un museo'], ['Oye, ¿qué más hay?', 'que mas hay'],
    ['No, mejor en Oaxaca', 'mejor en oaxaca'], ['Mmm... sí, ok, 3 días', '3 dias'],
  ])('stripLeadIns(%j) = %j', (message, expected) => expect(stripLeadIns(message)).toBe(expected));

  it('no elimina palabras que cambian el sentido dentro del mensaje', () => {
    expect(stripLeadIns('¿No hay museos?')).toBe('no hay museos'); // «no» sin coma conserva su sentido
    expect(stripLeadIns('No quiero ir a Oaxaca')).toBe('no quiero ir a oaxaca');
    expect(stripLeadIns('Si visito Puebla, ¿qué veo?')).toBe('si visito puebla que veo');
    expect(stripLeadIns('Ok')).toBe('ok');
    expect(stripLeadIns('Ruta por Puebla')).toBe('ruta por puebla');
  });

  it.each(['5 días', 'solo 3 días', 'una semana', 'de 5 días nada más', 'Ok, entonces 5 días', 'un fin de semana'])('duración aislada: «%s»', m => expect(bareDuration(m)).toBe(true));
  it.each(['¿Qué clima hace en 3 días?', 'Llego en 2 días, ¿qué llevo?', 'Hola', '5 museos', 'Itinerario de 5 días en Puebla'])('no es duración aislada: «%s»', m => expect(bareDuration(m)).toBe(false));

  it('stateChangeRequest exige un estado: «para mañana» no es cambio de estado', () => {
    expect(stateChangeRequest('No, mejor en Oaxaca')).toBe(true);
    expect(stateChangeRequest('Mejor para mañana')).toBe(false);
  });

  it('una semana = 7 días; dos semanas fuera de rango', () => {
    expect(extractDuration('una semana en Puebla')).toEqual({ days: 7 });
    expect(extractDuration('dos semanas')).toEqual({ outOfRange: true });
  });

  it('la duración aislada solo hereda el itinerario si el turno anterior del usuario lo era', () => {
    const itin = [{ role: 'user', content: 'Itinerario de 3 días en Puebla' }, { role: 'assistant', content: 'x' }];
    const normal = [{ role: 'user', content: '¿Qué lugares hay en Puebla?' }, { role: 'assistant', content: 'x' }];
    expect(itineraryContext('5 días', itin)).toMatchObject({ itinerary: true, duration: { days: 5 } });
    expect(itineraryContext('5 días', normal).itinerary).toBe(false);
    expect(itineraryContext('5 días', []).itinerary).toBe(false);
  });
});
