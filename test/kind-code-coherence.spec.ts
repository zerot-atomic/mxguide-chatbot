import { Logger } from '@nestjs/common';
import { ChatResponse, ChatService } from '../src/chat/chat.service';
import { PlacesService } from '../src/places/places.service';
import { LlmRequest, ProviderError } from '../src/chat/providers/llm-provider';
import { loadConfig } from '../src/config/env';
import { detectRequestedType } from '../src/places/place-types';
import { classifyIntent } from '../src/places/tourism-intent';

/** Coherencia kind/code/places, tipos de lugar sin categoría y diagnóstico sin datos personales. */
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tlaxcala = { id: id(29), name: 'Tlaxcala' };
const quintanaRoo = { id: id(23), name: 'Quintana Roo' };
const rec = (n: number, stateId: string, name: string, category: string, shortDescription = '') =>
  ({ id: id(500 + n), stateId, name, shortDescription, categories: [{ category: { name: category } }] });
const tlaxcalaPlaces = [
  rec(0, tlaxcala.id, 'Cacaxtla', 'Arqueológico'), rec(1, tlaxcala.id, 'Basílica de Ocotlán', 'Religioso'),
  rec(2, tlaxcala.id, 'Museo de Arte de Tlaxcala', 'Cultural'), rec(3, tlaxcala.id, 'La Malinche', 'Natural', 'Volcán con bosques.'),
];
const qrooPlaces = [
  rec(10, quintanaRoo.id, 'Playa Delfines', 'Natural', 'Mirador frente al mar Caribe.'),
  rec(11, quintanaRoo.id, 'Tulum', 'Arqueológico', 'Zona arqueológica frente a la playa.'),
  rec(12, quintanaRoo.id, 'Hotel Playa Azul', 'Hospedaje', 'Habitaciones frente al mar.'),
  rec(13, quintanaRoo.id, 'Cenote Azul', 'Natural', 'Cenote de agua cristalina.'),
  rec(14, quintanaRoo.id, 'Museo Maya', 'Cultural', 'Historia de la región.'),
];

let fetched: string[]; let calls: LlmRequest[]; let answer: (r: LlmRequest) => string;
const isSelector = (r: LlmRequest) => r.system.includes('selector');
const candidateIds = (r: LlmRequest): string[] => JSON.parse(r.message).candidates.map((p: { id: string }) => p.id);
const selectAll = (r: LlmRequest) => JSON.stringify({ placeIds: candidateIds(r).slice(0, 5) });

beforeEach(() => {
  fetched = []; calls = [];
  answer = r => (isSelector(r) ? selectAll(r) : 'Con gusto te ayudo.');
  jest.spyOn(globalThis, 'fetch').mockImplementation(async url => {
    const u = new URL(String(url));
    if (u.origin !== 'https://catalog.invalid') throw Error('No external network allowed');
    fetched.push(u.pathname + u.search);
    if (u.pathname === '/states') return new Response(JSON.stringify([tlaxcala, quintanaRoo]));
    const stateId = u.searchParams.get('stateId');
    const all = [...tlaxcalaPlaces, ...qrooPlaces];
    return new Response(JSON.stringify(stateId ? all.filter(p => p.stateId === stateId) : all));
  });
});
afterEach(() => jest.restoreAllMocks());

const makeService = (env: Record<string, string> = {}) => {
  const cfg = loadConfig({ GROQ_API_KEY: 'fake-groq-secret', MXGUIDE_API_URL: 'https://catalog.invalid', ...env });
  return new ChatService(cfg, [{ name: 'groq', isConfigured: () => true, generate: async r => { calls.push(r); return answer(r); } }], new PlacesService(cfg));
};
const service = () => makeService();

/** Invariantes del contrato (ver response-contract.ts). */
function assertCoherent(r: ChatResponse) {
  if (r.places.length > 0) {
    expect(['recommendation', 'itinerary']).toContain(r.kind);
    expect(['found', 'selection-fallback']).toContain(r.code);
  } else {
    expect(['conversation', 'notice', 'empty']).toContain(r.kind);
    expect(r.code).not.toBe('found');
    expect(r.code).not.toBe('selection-fallback');
  }
  if (r.kind === 'empty') expect(r.code).toBe('selection-empty');
  if (r.kind === 'notice') expect(r.places).toEqual([]);
  if (r.kind === 'conversation') expect(['conversation', 'conversation-guarded']).toContain(r.code);
  if (r.code === 'found' || r.code === 'selection-fallback') expect(r.places.length).toBeGreaterThan(0);
  expect(r.format).toBe('markdown');
}

describe('1. Caso reportado: «¿Qué playas puedo visitar en Tlaxcala?»', () => {
  it('sin evidencia en el catálogo: aviso type-unverified, sin IA y sin recomendar otros atractivos', async () => {
    const result = await service().chat({ message: '¿Qué playas puedo visitar en Tlaxcala?' });
    expect(result).toMatchObject({ kind: 'notice', code: 'type-unverified', places: [] });
    expect(result.reply).toContain('no clasifica playas como una categoría');
    expect(result.reply).toContain('Tlaxcala');
    expect(result.reply).not.toMatch(/Cacaxtla|Ocotlán|Malinche/);
    expect(calls).toHaveLength(0);
    expect(fetched).toContain(`/places?stateId=${tlaxcala.id}&limit=100`);
    assertCoherent(result);
  });

  it('misma pregunta sin «visitar» usa la misma muestra (100) y el mismo resultado', async () => {
    const result = await service().chat({ message: 'playas de Tlaxcala' });
    expect(result.code).toBe('type-unverified');
    expect(fetched).toContain(`/places?stateId=${tlaxcala.id}&limit=100`);
  });

  it('si el modelo no selecciona ninguno de los candidatos: kind empty + selection-empty, nunca found', async () => {
    answer = () => JSON.stringify({ placeIds: [] });
    const result = await service().chat({ message: '¿Qué atractivos hay en Tlaxcala?' });
    expect(result).toMatchObject({ kind: 'empty', code: 'selection-empty', places: [] });
    expect(result.reply).toContain('de Tlaxcala registrados en MXGuide');
    assertCoherent(result);
  });
});

describe('2. Tipos de lugar sin categoría: solo con evidencia del catálogo', () => {
  it('playas en Quintana Roo: solo registros que mencionan playa; un hotel no cuenta como playa', async () => {
    const result = await service().chat({ message: '¿Qué playas hay en Quintana Roo?' });
    expect(result.places.map(p => p.name).sort()).toEqual(['Playa Delfines', 'Tulum']);
    expect(result.reply).toMatch(/^Estos destinos de MXGuide mencionan playas en Quintana Roo:/);
    expect(JSON.parse(calls[0].message).candidates.map((c: { name: string }) => c.name)).not.toContain('Hotel Playa Azul');
    assertCoherent(result);
  });

  it('«hoteles de playa»: exige categoría Hospedaje y evidencia de playa', async () => {
    const result = await service().chat({ message: 'Hoteles de playa en Quintana Roo' });
    expect(result.places.map(p => p.name)).toEqual(['Hotel Playa Azul']);
  });

  it('cenotes: solo el registro que lo menciona, no todos los «Natural»', async () => {
    const result = await service().chat({ message: 'cenotes en Quintana Roo' });
    expect(result.places.map(p => p.name)).toEqual(['Cenote Azul']);
  });

  it.each([
    ['tours en Tlaxcala', 'tours'],
    ['pueblos mágicos de Tlaxcala', 'pueblos mágicos'],
    ['balnearios en Tlaxcala', 'balnearios'],
  ])('%s sin evidencia → aviso con la etiqueta «%s»', async (message, label) => {
    const result = await service().chat({ message });
    expect(result).toMatchObject({ kind: 'notice', code: 'type-unverified' });
    expect(result.reply).toContain(`no clasifica ${label}`);
    expect(calls).toHaveLength(0);
  });

  it('varios tipos a la vez: pide aclarar en vez de mezclar', async () => {
    const result = await service().chat({ message: 'playas y cenotes en Quintana Roo' });
    expect(result).toMatchObject({ kind: 'notice', code: 'intent-ambiguous', places: [] });
  });

  it('sin estado ni ubicación: busca evidencia en destacados', async () => {
    const result = await service().chat({ message: '¿Me recomiendas playas?' });
    expect(result.places.map(p => p.name).sort()).toEqual(['Playa Delfines', 'Tulum']);
  });

  it('el modelo no puede meter un registro sin evidencia aunque exista en el estado', async () => {
    answer = () => JSON.stringify({ placeIds: [id(514)] }); // Museo Maya: no menciona playas
    const result = await service().chat({ message: '¿Qué playas hay en Quintana Roo?' });
    expect(result.code).toBe('selection-fallback');
    expect(result.places.map(p => p.name)).not.toContain('Museo Maya');
  });

  it('categorías que sí existen no cambian: cascadas sigue siendo Natural', () => {
    expect(classifyIntent('cascadas en Tlaxcala')).toBe('nature');
    expect(detectRequestedType('cascadas en Tlaxcala')).toBeUndefined();
    expect(detectRequestedType('hay playas?')).toMatchObject({ key: 'beach' });
  });
});

describe('3. Matriz de invariantes kind/code/places', () => {
  const outputs: [string, (r: LlmRequest) => string][] = [
    ['selecciona todo', selectAll],
    ['selecciona vacío', () => JSON.stringify({ placeIds: [] })],
    ['formato inválido', () => 'texto libre'],
    ['ID inexistente', () => JSON.stringify({ placeIds: [id(999)] })],
    ['propiedad extra', r => JSON.stringify({ placeIds: candidateIds(r).slice(0, 1), reply: 'x' })],
  ];
  const messages = [
    'Hola', '¿Qué atractivos hay en Tlaxcala?', '¿Qué playas puedo visitar en Tlaxcala?', '¿Qué playas hay en Quintana Roo?',
    'Itinerario en Tlaxcala', 'Lugares cerca de mí', 'museos en Quintana Roo', 'playas y cenotes', 'Recomiéndame lugares',
  ];
  for (const message of messages) {
    it.each(outputs)(`«${message}» con modelo que %s`, async (_name, out) => {
      answer = r => (isSelector(r) ? out(r) : 'Con gusto te ayudo.');
      assertCoherent(await service().chat({ message }));
    });
  }

  it('itinerario con selección vacía también es selection-empty', async () => {
    answer = r => (isSelector(r) ? JSON.stringify({ placeIds: [] }) : 'x');
    const result = await service().chat({ message: 'Itinerario en Tlaxcala' });
    expect(result).toMatchObject({ kind: 'empty', code: 'selection-empty' });
  });

  it('contrato v2 intacto (mismas llaves)', async () => {
    for (const message of ['Hola', '¿Qué playas puedo visitar en Tlaxcala?', '¿Qué atractivos hay en Tlaxcala?']) {
      expect(Object.keys(await service().chat({ message })).sort()).toEqual(['code', 'format', 'kind', 'places', 'provider', 'reply', 'suggestions']);
    }
  });
});

describe('4. Registros de diagnóstico', () => {
  let logs: string[]; let warns: string[];
  beforeEach(() => {
    logs = []; warns = [];
    jest.spyOn(Logger.prototype, 'log').mockImplementation(function (m: unknown) { logs.push(String(m)); });
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(function (m: unknown) { warns.push(String(m)); });
  });
  const parse = (line: string) => JSON.parse(line.replace(/^chat /, ''));

  it('una línea por petición con ruta, estado, intención, candidatos, seleccionados, proveedor, resultado y duración', async () => {
    await makeService({ LOG_LEVEL: 'log' }).chat({ message: '¿Qué atractivos hay en Tlaxcala?' });
    expect(logs).toHaveLength(1);
    const d = parse(logs[0]);
    expect(d).toMatchObject({ route: 'catalog', catalogStatus: 'found', intent: 'attractions', mode: 'state', stateId: tlaxcala.id, candidates: 4, selected: 4, provider: 'groq', kind: 'recommendation', code: 'found', outcome: 'ok', historyTurns: 0, hasLocation: false });
    expect(typeof d.durationMs).toBe('number');
    expect(d.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('caso Tlaxcala: ruta notice, tipo pedido y sin proveedor invocado', async () => {
    await makeService({ LOG_LEVEL: 'log' }).chat({ message: '¿Qué playas puedo visitar en Tlaxcala?' });
    expect(parse(logs[0])).toMatchObject({ route: 'notice', catalogStatus: 'type-unverified', requestedType: 'beach', candidates: 0, selected: 0, provider: null, code: 'type-unverified' });
  });

  it('selección vacía queda visible: candidates > 0 y selected 0', async () => {
    answer = r => (isSelector(r) ? JSON.stringify({ placeIds: [] }) : 'x');
    await makeService({ LOG_LEVEL: 'log' }).chat({ message: '¿Qué atractivos hay en Tlaxcala?' });
    expect(parse(logs[0])).toMatchObject({ candidates: 4, selected: 0, code: 'selection-empty', kind: 'empty' });
  });

  it('conversación: ruta conversation, sin catálogo', async () => {
    await makeService({ LOG_LEVEL: 'log' }).chat({ message: 'Hola' });
    expect(parse(logs[0])).toMatchObject({ route: 'conversation', catalogStatus: 'conversation', candidates: 0, provider: 'groq', code: 'conversation' });
  });

  it('nunca registra mensaje, historial, nombre, ubicación, credenciales ni textos del catálogo', async () => {
    const svc = makeService({ LOG_LEVEL: 'log' });
    await svc.chat({
      message: 'Me llamo Ana López, tel 2221234567, ¿qué atractivos hay en Tlaxcala?',
      userName: 'Ana', location: { lat: 19.3181, lng: -98.2375 },
      history: [{ role: 'user', content: 'mi CURP es GOMA800101HPLRRN09' }, { role: 'assistant', content: '¡Hola, Ana! token=abc' }],
    });
    await svc.chat({ message: 'Hola, soy Ana', history: [{ role: 'user', content: 'secreto personal' }] });
    const all = [...logs, ...warns].join('\n');
    for (const leak of ['Ana', 'López', '2221234567', 'GOMA800101', '19.3181', '98.2375', 'token', 'secreto', 'fake-groq-secret', 'Cacaxtla', 'Tlaxcala', 'atractivos', 'Hola']) {
      expect(all).not.toContain(leak);
    }
    expect(parse(logs[0])).toMatchObject({ historyTurns: 2, hasLocation: true });
  });

  it('error de proveedor: aviso con motivo técnico fijo y línea con outcome error', async () => {
    const cfg = loadConfig({ GROQ_API_KEY: 'k', MXGUIDE_API_URL: 'https://catalog.invalid', LOG_LEVEL: 'log' });
    const failing = new ChatService(cfg, [{ name: 'groq', isConfigured: () => true, generate: async () => { throw new ProviderError('groq', 'HTTP 429', 429); } }], new PlacesService(cfg));
    await expect(failing.chat({ message: 'Hola' })).rejects.toThrow();
    expect(warns.join('\n')).toContain('Falló groq (HTTP 429)');
    expect(parse(logs[0])).toMatchObject({ outcome: 'error', error: 'ServiceUnavailableException', route: 'conversation' });
  });

  it('error inesperado del proveedor no filtra su mensaje', async () => {
    const cfg = loadConfig({ GROQ_API_KEY: 'k', MXGUIDE_API_URL: 'https://catalog.invalid', LOG_LEVEL: 'log' });
    const failing = new ChatService(cfg, [{ name: 'groq', isConfigured: () => true, generate: async () => { throw new Error('cuerpo interno con datos'); } }], new PlacesService(cfg));
    await expect(failing.chat({ message: 'Hola' })).rejects.toThrow();
    expect(warns.join('\n')).toContain('error inesperado');
    expect(warns.join('\n')).not.toContain('cuerpo interno');
  });

  it('catálogo con error: aviso con endpoint sin query (sin coordenadas)', async () => {
    jest.spyOn(globalThis, 'fetch').mockImplementation(async url => {
      const u = new URL(String(url));
      return u.pathname === '/states' ? new Response(JSON.stringify([tlaxcala])) : new Response('fallo', { status: 503 });
    });
    await makeService({ LOG_LEVEL: 'log' }).chat({ message: 'Lugares cerca de mí', location: { lat: 19.3181, lng: -98.2375 } });
    expect(warns.join('\n')).toContain('Catálogo /places/nearby: HTTP 503');
    expect(warns.join('\n')).not.toMatch(/19\.3181|lat=/);
    expect(parse(logs[0])).toMatchObject({ route: 'notice', catalogStatus: 'http' });
  });

  it('LOG_LEVEL=error silencia diagnóstico y avisos; nivel inválido no arranca', async () => {
    await makeService({ LOG_LEVEL: 'error' }).chat({ message: '¿Qué atractivos hay en Tlaxcala?' });
    expect(logs).toEqual([]);
    expect(() => loadConfig({ GROQ_API_KEY: 'k', LOG_LEVEL: 'todo' })).toThrow(/LOG_LEVEL/);
  });
});
