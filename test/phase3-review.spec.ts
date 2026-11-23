import { ChatService } from '../src/chat/chat.service';
import { PlacesService } from '../src/places/places.service';
import { LlmRequest } from '../src/chat/providers/llm-provider';
import { loadConfig } from '../src/config/env';
import { CONVERSATION_FALLBACK, guardConversationReply } from '../src/chat/conversation-guard';
import { validateIntro } from '../src/chat/verified-recommendation';
import { redactPersonalData, redactSelectionText, stripPersonalGreeting } from '../src/common/external-data';
import { isShortContinuation, mentionsKnownState } from '../src/places/state-hints';

/** Regresiones de la revisión de cierre de la fase 3 (hallazgos 1–5). */
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const states = [{ id: id(1), name: 'Puebla' }, { id: id(2), name: 'Oaxaca' }];
const catalog = [
  { id: id(100), stateId: id(1), name: 'Casa del Alfeñique', categories: [{ category: { name: 'Histórico' } }] },
  { id: id(101), stateId: id(1), name: 'Fuerte de Loreto', categories: [{ category: { name: 'Histórico' } }] },
  { id: id(102), stateId: id(2), name: 'Monte Albán', categories: [{ category: { name: 'Arqueológico' } }] },
];
const config = loadConfig({ GROQ_API_KEY: 'fake-key', MXGUIDE_API_URL: 'https://catalog.invalid', PLACES_TIMEOUT_MS: '1000' });
let fetched: string[]; let calls: LlmRequest[]; let answer: (r: LlmRequest) => string; let hang: boolean;
const isSelector = (r: LlmRequest) => r.system.includes('selector');
const selectAll = (r: LlmRequest, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ placeIds: JSON.parse(r.message).candidates.map((p: { id: string }) => p.id), ...extra });

beforeEach(() => {
  fetched = []; calls = []; hang = false;
  answer = r => (isSelector(r) ? selectAll(r) : 'Con gusto te ayudo.');
  jest.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const u = new URL(String(url));
    if (u.origin !== 'https://catalog.invalid') throw Error('No external network allowed');
    fetched.push(u.pathname);
    if (hang) await new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(Object.assign(Error('t'), { name: 'TimeoutError' }))));
    if (u.pathname === '/states') return new Response(JSON.stringify(states));
    const s = u.searchParams.get('stateId');
    return new Response(JSON.stringify(s ? catalog.filter(p => p.stateId === s) : catalog));
  });
});
afterEach(() => jest.restoreAllMocks());
const service = () => new ChatService(config, [{ name: 'groq', isConfigured: () => true, generate: async r => { calls.push(r); return answer(r); } }], new PlacesService(config));
const puebla = '¿Qué lugares históricos hay en Puebla?';

describe('1a. Introducción turística: sin destinos ni datos fuera de la lista blanca', () => {
  const cands = [{ id: id(100), name: 'Casa del Alfeñique', state: 'Puebla', category: '', description: '' }];
  it.each([
    'Atlantis es una maravilla, mira esta selección.',
    'También te encantará Hierve el Agua en Oaxaca.',
    'Te va a gustar tanto como Cancún, mira esta selección.',
    'Mira esta selección del Hotel Paraíso para ti.',
    'Oaxaca también es preciosa, pero aquí va Puebla.',
    'xxxxxxxxxx', 'aaaa bbbb cccc', 'Holaaaaa amigooo viajeroooo',
  ])('rechaza: %s', m => expect(validateIntro(m, cands, ['Puebla'])).toBeUndefined());

  it.each([
    '¡Qué buena idea! Puebla tiene mucha historia para descubrir.',
    'Te comparto una selección muy bonita para empezar.',
    'Claro que sí, aquí tienes ideas para tu viaje por México.',
    'Para tu visita a Puebla, mira esta selección.',
  ])('acepta tono sin hechos: %s', m => expect(validateIntro(m, cands, ['Puebla'])).toBe(m));

  it('en el flujo real, la intro con lugar ajeno usa plantilla y conserva tarjetas validadas', async () => {
    answer = r => (isSelector(r) ? selectAll(r, { message: 'También te encantará Hierve el Agua en Oaxaca.' }) : 'x');
    const result = await service().chat({ message: puebla });
    expect(result.reply).not.toMatch(/Hierve|Oaxaca/);
    expect(result.reply).toMatch(/^Para acercarte a la historia local/);
    expect(result.places.map(p => p.id)).toEqual([id(100), id(101)]);
    expect(result.code).toBe('found');
  });

  it('sin estado (destacados o cercanía) no se permite ningún nombre propio salvo México', () => {
    expect(validateIntro('Puebla te encantará, mira esta selección.', cands)).toBeUndefined();
    expect(validateIntro('Aquí tienes ideas para recorrer México.', cands)).toBe('Aquí tienes ideas para recorrer México.');
  });
});

describe('1b. Conversación: guarda de destinos y datos inventados sin perder naturalidad', () => {
  it.each([
    'Te recomiendo Hierve el Agua y las Grutas de Tolantongo.',
    'El museo abre a las nueve de la mañana.',
    'La entrada cuesta cien pesos.',
    'El tour cuesta ochenta dólares.',
    'Abre de 9 a 17 h.',
    'Cierra a las 18 h los lunes.',
    'Hospédate en el Hotel Ficticio Plaza, tiene alberca.',
    'Visita el Museo Nacional de Antropología.',
    'Come en la Fonda Doña Chela.',
    'La entrada es gratis todos los domingos.',
    'No te pierdas Tulum al amanecer.',
  ])('sustituye: %s', t => expect(guardConversationReply(t)).toEqual({ reply: CONVERSATION_FALLBACK, replaced: true }));

  it.each([
    '¡Hola! Soy Mictlán. ¿Qué estado de México te gustaría conocer?',
    'Te recomiendo visitar Oaxaca en otoño, el clima es agradable.',
    'Para el Día de Muertos, Michoacán y Oaxaca son muy especiales.',
    'Las playas de Quintana Roo son populares; conoce Yucatán también.',
    'En 2 o 3 días puedes recorrer mucho; el Día de Muertos es el 2 de noviembre.',
    'Lleva ropa ligera, bloqueador y agua. Ve a tu ritmo.',
    'Si visitas la Ciudad de México, usa transporte público.',
    'La gastronomía mexicana incluye mole, tamales y pozole.',
    'Puedes visitar museos y zonas arqueológicas; dime el estado y te muestro opciones.',
  ])('conserva conversación natural: %s', t => expect(guardConversationReply(t).replaced).toBe(false));

  it('flujo: respuesta con lugar inventado → conversation-guarded, sin tarjetas', async () => {
    answer = () => 'Te recomiendo Hierve el Agua, es precioso.';
    expect(await service().chat({ message: 'Hola' })).toMatchObject({ kind: 'conversation', code: 'conversation-guarded', places: [], reply: CONVERSATION_FALLBACK });
  });
});

describe('2. Redacción de datos personales en mensaje e historial', () => {
  it.each([
    ['Mi teléfono es 222 123 4567', '[teléfono omitido]'],
    ['tel +52 55 1234 5678', '[teléfono omitido]'],
    ['llámame al 2221234567', '[teléfono omitido]'],
    ['mi CURP es GOMA800101HPLRRN09', '[CURP omitida]'],
    ['RFC GOMA800101AB1', '[RFC omitido]'],
    ['tarjeta 4111 1111 1111 1111', '[tarjeta omitida]'],
    ['4111-1111-1111-1111', '[tarjeta omitida]'],
    ['vivo en Av. Reforma 123, Col. Centro', '[dirección omitida], [dirección omitida]'],
    ['C.P. 72000', '[código postal omitido]'],
    ['estoy en 19.0414, -98.2063', '[ubicación omitida]'],
    ['Me llamo Ana López y voy a Puebla', 'Me llamo [nombre omitido] y voy a Puebla'],
    ['mi correo es ana@x.com', '[correo omitido]'],
  ])('%s', (input, expected) => expect(redactSelectionText(input, [])).toContain(expected));

  it.each([
    'En 2 o 3 días, el 2 de noviembre de 2026',
    'viajamos 15 personas',
    'soy de México y me gusta lo colonial de 1531',
    'Llego el 12/12 a las 10:30',
    'una pirámide de 65 metros',
  ])('no altera texto turístico común: %s', t => expect(redactPersonalData(t)).toBe(t));

  it('quita el saludo personalizado de los turnos assistant', () => {
    expect(stripPersonalGreeting('¡Hola, Ana María! ¿A dónde vamos?')).toBe('¿A dónde vamos?');
    expect(stripPersonalGreeting('¡Hola! ¿A dónde vamos?')).toBe('¡Hola! ¿A dónde vamos?');
  });

  it('conversación: historial y mensaje llegan sin nombre, teléfono, CURP ni coordenadas', async () => {
    await service().chat({
      message: 'Me llamo Ana López, mi cel 2221234567, ¿qué llevo?',
      userName: 'Ana',
      history: [
        { role: 'user', content: 'Hola, mi CURP es GOMA800101HPLRRN09 y estoy en 19.0414, -98.2063' },
        { role: 'assistant', content: '¡Hola, Ana! ¡Hola! ¿A dónde vamos?' },
      ],
    });
    const sent = JSON.stringify(calls[0]);
    for (const leak of ['Ana', '2221234567', 'GOMA800101HPLRRN09', '19.0414']) expect(sent).not.toContain(leak);
    expect(calls[0].history[1].content).toBe('¡Hola! ¿A dónde vamos?');
  });

  it('selector turístico: la query llega redactada y la búsqueda sigue funcionando', async () => {
    const result = await service().chat({ message: 'Me llamo Ana López, tel 2221234567, ¿qué lugares históricos hay en Puebla?' });
    const query = JSON.parse(calls[0].message).query;
    expect(query).not.toMatch(/Ana López|2221234567/);
    expect(result.places.map(p => p.id)).toEqual([id(100), id(101)]);
  });
});

describe('3. Herencia de contexto en seguimientos', () => {
  const history = [{ role: 'user' as const, content: '¿Qué lugares hay en Oaxaca?' }, { role: 'assistant' as const, content: '- **Monte Albán**' }];

  it.each(['¿Y qué ropa llevo?', '¿Y cuánto cuesta el vuelo?', '¿y tú quién eres?', 'Ahí hace calor?', '¿Y qué tal la comida allá?'])(
    'un «¿y…?» de otro tema es conversación y no busca: %s', async message => {
      const result = await service().chat({ message, history });
      expect(result.kind).toBe('conversation');
      expect(fetched.filter(p => p.startsWith('/places'))).toEqual([]);
    });

  it.each(['¿Y cuáles más hay allí?', '¿Qué otros hay?', '¿Y qué más?', 'cuáles más', '¿Algo más por ahí?'])(
    'continuación corta conserva el estado: %s', async message => {
      const result = await service().chat({ message, history });
      // Oaxaca solo tiene Monte Albán y ya se mostró: se avisa en el mismo estado, sin repetir ni mezclar.
      expect(result).toMatchObject({ kind: 'notice', code: 'exhausted', places: [] });
      expect(result.reply).toContain('de Oaxaca');
      expect(fetched.filter(p => p.startsWith('/places'))).toEqual(['/places']);
    });

  it('un seguimiento con señal turística también conserva el estado', async () => {
    const result = await service().chat({ message: '¿Y hay sitios arqueológicos allí?', history });
    expect(result.places.map(p => p.id)).toEqual([id(102)]);
  });

  it('isShortContinuation acota la forma y la longitud', () => {
    expect(isShortContinuation('¿Y cuáles más hay por ahí?')).toBe(true);
    expect(isShortContinuation('¿y qué ropa llevo?')).toBe(false);
    expect(isShortContinuation('¿Qué otros hay que valgan la pena para ir con niños y abuelos?')).toBe(false);
  });
});

describe('4. /states solo cuando el mensaje puede requerir búsqueda turística', () => {
  it.each(['Hola', 'Gracias', '¿Qué clima hace en diciembre?', '¿Cómo se dice gracias en náhuatl?', '¿Y qué ropa llevo?'])(
    'sin señal ni estado posible: no hay ninguna petición al catálogo: %s', async message => {
      const result = await service().chat({ message });
      expect(result.kind).toBe('conversation');
      expect(fetched).toEqual([]);
    });

  it('catálogo dormido no retrasa un saludo', async () => {
    hang = true;
    const start = Date.now();
    expect((await service().chat({ message: 'Hola' })).kind).toBe('conversation');
    expect(Date.now() - start).toBeLessThan(300);
    expect(fetched).toEqual([]);
  });

  it.each(['Oaxaca', '¿Qué hay en la CDMX?', 'Soy de México'])('posible estado: sí consulta /states: %s', async message => {
    await service().chat({ message });
    expect(fetched[0]).toBe('/states');
  });

  it('mentionsKnownState es solo una pista léxica', () => {
    expect(mentionsKnownState('voy a yucatán')).toBe(true);
    expect(mentionsKnownState('hola qué tal')).toBe(false);
  });
});

describe('5. Lista blanca intacta', () => {
  it.each([
    JSON.stringify({ placeIds: [id(102)] }),
    JSON.stringify({ placeIds: [id(999)], message: 'Aquí tienes algo especial.' }),
    `{"placeIds":["${id(100)}"],"placeIds":["${id(999)}"]}`,
    JSON.stringify({ placeIds: [id(100)], message: 'ok', reply: 'Atlantis' }),
  ])('salida fuera de lista blanca → selection-fallback con tarjetas del estado: %s', async out => {
    answer = r => (isSelector(r) ? out : 'x');
    const result = await service().chat({ message: puebla });
    expect(result.code).toBe('selection-fallback');
    expect(result.places.every(p => [id(100), id(101)].includes(p.id))).toBe(true);
    expect(result.reply).not.toMatch(/Atlantis|especial|Monte Albán/);
  });

  it('respuesta de contrato v2 intacta', async () => {
    const result = await service().chat({ message: puebla });
    expect(Object.keys(result).sort()).toEqual(['code', 'format', 'kind', 'places', 'provider', 'reply', 'suggestions']);
  });
});
