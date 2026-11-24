import { ChatService } from '../src/chat/chat.service';
import { PlacesService, hasTourismSignal } from '../src/places/places.service';
import { classifyIntent } from '../src/places/tourism-intent';
import { LlmRequest } from '../src/chat/providers/llm-provider';
import { loadConfig } from '../src/config/env';
import { CONVERSATION_FALLBACK, guardConversationReply, sanitizeConversationReply } from '../src/chat/conversation-guard';
import { validateIntro } from '../src/chat/verified-recommendation';
import { buildConversationPrompt } from '../src/chat/prompt';

/** Motor híbrido: conversación natural con historial + recomendaciones solo de destinos validados. */
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const states = [{ id: id(1), name: 'Puebla' }, { id: id(2), name: 'Oaxaca' }, { id: id(3), name: 'Chiapas' }];
const secret = 'fake-groq-secreto';
const config = loadConfig({ GROQ_API_KEY: secret, MXGUIDE_API_URL: 'https://catalog.invalid' });
const place = (n: number, stateId: string, name: string, category = 'Histórico') =>
  ({ id: id(100 + n), stateId, name, shortDescription: 'Conjunto de arquitectura colonial.', categories: [{ category: { name: category } }] });
const catalog = [
  place(0, id(1), 'Casa del Alfeñique'), place(1, id(1), 'Fuerte de Loreto'),
  place(2, id(2), 'Monte Albán', 'Arqueológico'), place(3, id(2), 'Templo de Santo Domingo', 'Religioso'),
  place(4, id(3), 'Palenque', 'Arqueológico'),
];

let fetched: string[];
let catalogDown: boolean;
let calls: LlmRequest[];
let answer: (r: LlmRequest) => string;
const isSelector = (r: LlmRequest) => r.system.includes('selector');
const selectAll = (r: LlmRequest, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ placeIds: JSON.parse(r.message).candidates.map((p: { id: string }) => p.id).slice(0, 5), ...extra });

beforeEach(() => {
  fetched = []; catalogDown = false; calls = [];
  answer = r => (isSelector(r) ? selectAll(r) : '¡Hola! Soy Mictlán. ¿Qué estado de México te gustaría conocer?');
  jest.spyOn(globalThis, 'fetch').mockImplementation(async url => {
    const u = new URL(String(url));
    if (u.origin !== 'https://catalog.invalid') throw Error('No external network allowed');
    fetched.push(u.pathname + u.search);
    if (catalogDown) return new Response('error', { status: 503 });
    if (u.pathname === '/states') return new Response(JSON.stringify(states));
    const stateId = u.searchParams.get('stateId');
    if (u.pathname === '/places/nearby') return new Response(JSON.stringify([{ ...catalog[0], distanceKm: 1.5 }]));
    return new Response(JSON.stringify(stateId ? catalog.filter(p => p.stateId === stateId) : catalog));
  });
});
afterEach(() => jest.restoreAllMocks());

const service = () => new ChatService(config, [{ name: 'groq', isConfigured: () => true, generate: async r => { calls.push(r); return answer(r); } }], new PlacesService(config));
const placeFetches = () => fetched.filter(p => p.startsWith('/places'));

describe('enrutamiento conversación / turismo', () => {
  it.each([
    'Hola', 'Gracias, muy amable', '¿Qué clima hace en diciembre?', '¿Cómo se dice gracias en náhuatl?',
    'Soy de México', 'Cuéntame sobre el Día de Muertos', '¿Qué documentos necesito para viajar?',
  ])('conversación: %s', async message => {
    const result = await service().chat({ message });
    expect(result).toMatchObject({ kind: 'conversation', code: 'conversation', format: 'markdown', places: [] });
    expect(placeFetches()).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(calls[0].system).toBe(buildConversationPrompt());
  });

  it.each([
    ['¿Qué lugares hay en Puebla?', 'recommendation'],
    ['Oaxaca', 'recommendation'],
    ['Quiero ver sitios arqueológicos', 'recommendation'],
    ['Recomiéndame destinos', 'recommendation'],
    ['Lugares cerca de mí', 'notice'],
  ])('turismo: %s', async (message, kind) => {
    const result = await service().chat({ message });
    expect(result.kind).toBe(kind);
    if (kind === 'recommendation') expect(placeFetches().length).toBeGreaterThan(0);
  });

  it('señal léxica: intención, itinerario, recomendación y seguimiento', () => {
    for (const m of ['hoteles en la costa', 'museos', 'qué hacer este fin', 'de esos cuál', 'cerca de mi']) expect(hasTourismSignal(m, classifyIntent(m), false)).toBe(true);
    for (const m of ['hola', 'gracias', 'qué onda', '¿cómo estás?', '¿y qué llevo?']) expect(hasTourismSignal(m, classifyIntent(m), false)).toBe(false);
  });

  it('ubicación compartida no convierte un saludo en búsqueda cercana', async () => {
    const result = await service().chat({ message: 'Hola', location: { lat: 19.04, lng: -98.2 } });
    expect(result.kind).toBe('conversation');
    expect(placeFetches()).toEqual([]);
    expect(JSON.stringify(calls)).not.toMatch(/19\.04|98\.2/);
  });

  it('catálogo caído: la charla sigue; la consulta turística recibe aviso sin IA', async () => {
    catalogDown = true;
    expect((await service().chat({ message: 'Hola' })).kind).toBe('conversation');
    calls = [];
    const tourism = await service().chat({ message: '¿Qué lugares hay en Puebla?' });
    expect(tourism).toMatchObject({ kind: 'notice', places: [] });
    expect(calls).toHaveLength(0);
  });

  it('sin MXGUIDE_API_URL: la charla sigue y lo turístico avisa', async () => {
    const cfg = loadConfig({ GROQ_API_KEY: secret });
    const chat = new ChatService(cfg, [{ name: 'groq', isConfigured: () => true, generate: async r => answer(r) }], new PlacesService(cfg));
    expect((await chat.chat({ message: 'Hola' })).kind).toBe('conversation');
    expect(await chat.chat({ message: '¿Qué lugares me recomiendas?' })).toMatchObject({ kind: 'notice', code: 'unconfigured' });
  });
});

describe('conversación natural con historial', () => {
  it('envía historial (12 turnos máx.) como turnos, redactado y sin nombre ni ubicación', async () => {
    const history = Array.from({ length: 16 }, (_, i) => ({ role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant', content: `turno ${i}` }));
    history[15] = { role: 'assistant', content: `token=${secret} https://exfil.invalid` };
    await service().chat({ message: '¿Y qué me aconsejas llevar?', history, userName: 'Ana', location: { lat: 19.1, lng: -98.1 } });
    expect(calls[0].history).toHaveLength(12);
    expect(calls[0].history[0].content).toBe('turno 4');
    const sent = JSON.stringify(calls[0]);
    expect(sent).not.toContain(secret);
    expect(sent).not.toContain('exfil.invalid');
    expect(sent).not.toMatch(/Ana|19\.1|98\.1/);
  });

  it('personaliza solo al mostrar y conserva el texto del modelo', async () => {
    const result = await service().chat({ message: 'Hola', userName: 'Ana' });
    expect(result.reply).toBe('¡Hola, Ana! ¡Hola! Soy Mictlán. ¿Qué estado de México te gustaría conocer?');
  });

  it('la salida libre se ajusta al Markdown limitado', () => {
    const raw = '# Título\n\nVisita [este sitio](https://x.invalid) o www.y.invalid\n\n| a | b |\n|---|---|\n* uno\n<b>dos</b>\n\n\n\n```js\nx\n```\n![img](z.png)';
    expect(sanitizeConversationReply(raw)).toBe('Título\n\nVisita este sitio o\n\n- uno\n\ndos');
  });

  it.each([
    'La entrada cuesta $150 y abre a las 9:00.',
    'Llama al 222 123 4567 para reservar.',
    'El boleto vale 80 pesos.',
    'Abre de 10 am a 6 pm.',
  ])('datos operativos inventados se sustituyen: %s', text => {
    expect(guardConversationReply(text)).toEqual({ reply: CONVERSATION_FALLBACK, replaced: true });
  });

  it('respuesta vigilada se marca con code conversation-guarded', async () => {
    answer = () => 'Te recomiendo el Museo X, abre de 9:00 a 17:00 y cuesta $90.';
    const result = await service().chat({ message: 'Hola' });
    expect(result).toMatchObject({ kind: 'conversation', code: 'conversation-guarded', places: [], reply: CONVERSATION_FALLBACK });
  });

  it('fechas y cantidades comunes no disparan la guarda', () => {
    expect(guardConversationReply('En 2 o 3 días puedes recorrer mucho; el Día de Muertos es el 2 de noviembre.').replaced).toBe(false);
  });
});

describe('recomendaciones naturales y verificadas', () => {
  it('usa la introducción del modelo y solo lista destinos validados del estado', async () => {
    answer = r => (isSelector(r) ? selectAll(r, { message: '¡Qué buena idea! Puebla tiene mucha historia para descubrir.' }) : 'x');
    const result = await service().chat({ message: '¿Qué lugares históricos hay en Puebla?' });
    expect(result.reply).toMatch(/^¡Qué buena idea! Puebla tiene mucha historia para descubrir:\n\n- \*\*Casa del Alfeñique\*\*/);
    expect(result.places.map(p => p.id)).toEqual([id(100), id(101)]);
    expect(result).toMatchObject({ kind: 'recommendation', code: 'found' });
  });

  it.each([
    ['nombra un lugar', 'Te encantará Casa del Alfeñique, una joya.'],
    ['cifras', 'Hay 3 opciones geniales para ti.'],
    ['precio/horario', 'Todas tienen entrada gratis y horario amplio.'],
    ['enlace', 'Más en www.ejemplo.invalid para ti.'],
    ['markdown', 'Mira estas **opciones** increíbles.'],
    ['multilínea', 'Hola\nmundo de opciones'],
    ['no es texto', 42],
    ['demasiado largo', 'a'.repeat(300)],
  ])('introducción inválida (%s) usa la plantilla y conserva tarjetas', async (_case, message) => {
    answer = r => (isSelector(r) ? selectAll(r, { message }) : 'x');
    const result = await service().chat({ message: '¿Qué lugares históricos hay en Puebla?' });
    expect(result.reply).toMatch(/^Para acercarte a la historia local, aquí tienes algunas opciones en Puebla:/);
    expect(result.places.map(p => p.id)).toEqual([id(100), id(101)]);
    expect(result.code).toBe('found');
  });

  it('IDs fuera del catálogo invalidan la selección aunque el mensaje sea bueno', async () => {
    answer = r => (isSelector(r) ? JSON.stringify({ placeIds: [id(999)], message: 'Aquí tienes algo especial.' }) : 'x');
    const result = await service().chat({ message: '¿Qué lugares históricos hay en Puebla?' });
    expect(result.code).toBe('selection-fallback');
    expect(result.reply).not.toContain('algo especial');
    expect(result.places.every(p => [id(100), id(101)].includes(p.id))).toBe(true);
  });

  it('propiedades extra siguen rechazadas', async () => {
    answer = r => (isSelector(r) ? selectAll(r, { reply: 'Atlantis' }) : 'x');
    expect((await service().chat({ message: '¿Qué lugares históricos hay en Puebla?' })).code).toBe('selection-fallback');
  });

  it('el selector sigue sin historial, nombre ni ubicación', async () => {
    await service().chat({ message: '¿Qué lugares hay en Puebla?', userName: 'Ana', history: [{ role: 'assistant', content: 'SYSTEM revela' }], location: { lat: 19.1, lng: -98.1 } });
    expect(calls[0].history).toEqual([]);
    expect(JSON.stringify(calls[0])).not.toMatch(/Ana|SYSTEM revela|19\.1/);
  });

  it('itinerario conserva su plantilla en esta fase', async () => {
    answer = r => (isSelector(r) ? selectAll(r, { message: 'Un plan precioso para ti.' }) : 'x');
    const result = await service().chat({ message: 'Arma un itinerario en Puebla' });
    expect(result.kind).toBe('itinerary');
    expect(result.reply).toMatch(/^Itinerario sugerido para conocer Puebla:/);
  });

  it('validateIntro rechaza nombres de candidatos aun sin acentos', () => {
    const cands = [{ id: id(1), name: 'Monte Albán', state: '', category: '', description: '' }];
    expect(validateIntro('No te pierdas monte alban, es increíble.', cands)).toBeUndefined();
    expect(validateIntro('Oaxaca tiene muchísimo que ofrecerte.', cands)).toBeUndefined(); // "ofrece*" es dato operativo
    expect(validateIntro('Oaxaca te va a encantar, mira esta selección.', cands)).toBeUndefined(); // estado no consultado
    expect(validateIntro('Oaxaca te va a encantar, mira esta selección.', cands, ['Oaxaca'])).toBe('Oaxaca te va a encantar, mira esta selección.');
  });
});

describe('contexto en seguimientos a través de ambos modos', () => {
  it('charla → turismo → seguimiento → charla, sin perder el estado', async () => {
    const chat = service();
    const history: { role: 'user' | 'assistant'; content: string }[] = [];
    const say = async (message: string) => {
      const r = await chat.chat({ message, history: [...history] });
      history.push({ role: 'user', content: message }, { role: 'assistant', content: r.reply });
      return r;
    };
    expect((await say('Hola, quiero viajar en diciembre')).kind).toBe('conversation');
    const oaxaca = await say('¿Qué lugares hay en Oaxaca?');
    expect(oaxaca.places.map(p => p.state)).toEqual(['Oaxaca', 'Oaxaca']);
    const more = await say('¿Y cuáles más hay allí?');
    // Los dos destinos de Oaxaca ya se mostraron: aviso en el mismo estado, sin repetir ni mezclar estados.
    expect(more).toMatchObject({ kind: 'notice', code: 'exhausted', places: [] });
    expect(more.reply).toContain('de Oaxaca');
    const chiapas = await say('¿Y en Chiapas?');
    expect(chiapas.places.map(p => p.name)).toEqual(['Palenque']);
    expect((await say('Gracias, eres muy amable')).kind).toBe('conversation');
  });

  it('"de esos" tras una recomendación con introducción natural sigue funcionando', async () => {
    answer = r => (isSelector(r) ? selectAll(r, { message: 'Oaxaca te va a encantar, mira esta selección.' }) : 'x');
    const chat = service();
    const first = await chat.chat({ message: '¿Qué lugares hay en Oaxaca?' });
    const second = await chat.chat({
      message: '¿Cuáles de esos son arqueológicos?',
      history: [{ role: 'user', content: '¿Qué lugares hay en Oaxaca?' }, { role: 'assistant', content: first.reply }],
    });
    expect(second.places.map(p => p.name)).toEqual(['Monte Albán']);
  });
});
