import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { APP_CONFIG, loadConfig } from '../src/config/env';
import { LLM_PROVIDERS, LlmRequest } from '../src/chat/providers/llm-provider';
import { configureHttp } from '../src/common/configure-http';
import { ChatService } from '../src/chat/chat.service';
import { PlacesService } from '../src/places/places.service';
import { legacyEscaped, markdownSafe } from '../src/chat/response-contract';
import { previousRecommendationIds } from '../src/places/followup-context';

/** Contrato v2: reply en Markdown limitado + format/kind/code; errores con error.code. */
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const puebla = { id: id(1), name: 'Puebla' };
const config = loadConfig({ GROQ_API_KEY: 'ficticio-groq', MXGUIDE_API_URL: 'https://catalog.invalid' });
const record = (n: number, name: string, category = 'Histórico', shortDescription = 'Conjunto de arquitectura colonial.') =>
  ({ id: id(100 + n), stateId: puebla.id, name, shortDescription, categories: [{ category: { name: category } }] });

let records: unknown[];
let output: (r: LlmRequest) => string;
const selectAll = (r: LlmRequest) => JSON.stringify({ placeIds: JSON.parse(r.message).candidates.map((p: { id: string }) => p.id).slice(0, 5) });

function mockCatalog() {
  jest.spyOn(globalThis, 'fetch').mockImplementation(async url => {
    const u = new URL(String(url));
    if (u.origin !== 'https://catalog.invalid') throw Error('No external network allowed');
    return new Response(JSON.stringify(u.pathname === '/states' ? [puebla] : records));
  });
}
const service = () => new ChatService(config, [{ name: 'groq', isConfigured: () => true, generate: async r => output(r) }], new PlacesService(config));

beforeEach(() => { records = [record(0, 'Casa del Alfeñique'), record(1, 'Templo de Santo Domingo')]; output = selectAll; mockCatalog(); });
afterEach(() => jest.restoreAllMocks());

/** Bloques Markdown: una lista nunca debe tener texto pegado (continuación perezosa en CommonMark). */
function assertListsAreClosed(reply: string) {
  const lines = reply.split('\n');
  lines.forEach((line, i) => {
    const isItem = /^(?:- |\d+\. )/.test(line);
    const next = lines[i + 1];
    if (isItem && next !== undefined) expect(next === '' || /^(?:- |\d+\. )/.test(next)).toBe(true);
    if (isItem && i > 0) expect(lines[i - 1] === '' || /^(?:- |\d+\. )/.test(lines[i - 1])).toBe(true);
  });
}

describe('markdownSafe', () => {
  it.each([
    ['Museo *Amparo*', 'Museo Amparo'],
    ['Casa_del_Alfeñique', 'Casa del Alfeñique'],
    ['[Zócalo](ruta)', 'Zócalo(ruta)'],
    ['<b>Fuerte</b> de Loreto', 'bFuerte/b de Loreto'],
    ['# Catedral', 'Catedral'],
    ['- Ex convento', 'Ex convento'],
    ['1. Barrio del Artista', 'Barrio del Artista'],
    ['Línea\nnueva\tcon tabs', 'Línea nueva con tabs'],
    ['Tlaxcalancingo | Cholula ~ `x`', 'Tlaxcalancingo Cholula x'],
    ['Ruta \\ escapada', 'Ruta escapada'],
  ])('%j → %j', (input, expected) => expect(markdownSafe(input)).toBe(expected));

  it('conserva acentos, ñ, puntuación común y paréntesis', () =>
    expect(markdownSafe('Capilla del Rosario (Santo Domingo), ¡imperdible!')).toBe('Capilla del Rosario (Santo Domingo), ¡imperdible!'));
});

describe('reply v2 en servicio', () => {
  it('recomendación: format/kind/code, nombres en negritas, sin escapes y listas cerradas', async () => {
    const result = await service().chat({ message: '¿Qué lugares históricos hay en Puebla?' });
    expect(result).toMatchObject({ format: 'markdown', kind: 'recommendation', code: 'found' });
    expect(result.places.map(p => p.id)).toEqual([id(100), id(101)]);
    expect(result.reply).toContain('- **Casa del Alfeñique**: Conjunto de arquitectura colonial.');
    expect(result.reply).not.toMatch(/\\/);
    expect(result.reply).toMatch(/:\n\n- /);
    assertListsAreClosed(result.reply);
  });

  it('nombres con caracteres Markdown no rompen negritas ni producen diagonales', async () => {
    records = [record(0, 'Museo *Amparo* [MX]'), record(1, 'Casa_de_los_Muñecos <b>')];
    const result = await service().chat({ message: '¿Qué lugares históricos hay en Puebla?' });
    expect(result.places.map(p => p.name)).toEqual(['Museo *Amparo* [MX]', 'Casa_de_los_Muñecos <b>']);
    const items = result.reply.split('\n').filter(l => l.startsWith('- '));
    expect(items).toEqual(['- **Museo Amparo MX**: Conjunto de arquitectura colonial.', '- **Casa de los Muñecos b**: Conjunto de arquitectura colonial.']);
    for (const item of items) expect(item.match(/\*\*/g)).toHaveLength(2);
    expect(result.reply).not.toMatch(/[\\<>\[\]`]/);
  });

  it('itinerario: kind itinerary, lista numerada cerrada por línea en blanco', async () => {
    const result = await service().chat({ message: 'Arma un itinerario en Puebla' });
    expect(result).toMatchObject({ format: 'markdown', kind: 'itinerary', code: 'found' });
    expect(result.reply).toContain('1. **Casa del Alfeñique**');
    assertListsAreClosed(result.reply);
  });

  it('aviso local: kind notice, code del catálogo y sin llamar a IA', async () => {
    let called = false;
    output = r => { called = true; return selectAll(r); };
    const result = await service().chat({ message: 'Lugares cerca de mí' });
    expect(result).toMatchObject({ format: 'markdown', kind: 'notice', code: 'missing-location', places: [] });
    expect(called).toBe(false);
  });

  it('salida inválida del modelo: code selection-fallback y tarjetas solo del catálogo filtrado', async () => {
    output = () => 'Museo inventado, abierto 24 horas';
    const result = await service().chat({ message: '¿Qué lugares históricos hay en Puebla?' });
    expect(result).toMatchObject({ kind: 'recommendation', code: 'selection-fallback' });
    expect(result.places.map(p => p.id)).toEqual([id(100), id(101)]);
    expect(result.reply).not.toContain('inventado');
  });

  it('sin coincidencias: kind notice y code empty', async () => {
    records = [];
    const result = await service().chat({ message: '¿Qué lugares históricos hay en Puebla?' });
    expect(result).toMatchObject({ kind: 'notice', code: 'empty', places: [] });
  });

  it('personalización se mantiene al inicio y no rompe Markdown', async () => {
    const result = await service().chat({ message: '¿Qué lugares históricos hay en Puebla?', userName: 'Ana' });
    expect(result.reply).toMatch(/^¡Hola, Ana! /);
    assertListsAreClosed(result.reply);
  });
});

describe('"de esos" con historial v1 y v2', () => {
  const candidates = [
    { id: id(100), name: 'Museo *Amparo*', state: 'Puebla', category: 'Histórico', description: '' },
    { id: id(101), name: 'Fuerte de Loreto', state: 'Puebla', category: 'Histórico', description: '' },
  ];
  const turn = (reply: string) => [{ role: 'user', content: 'históricos en Puebla' }, { role: 'assistant', content: reply }];

  it('lee el formato v2 con negritas', () => {
    const reply = 'Intro:\n\n- **Museo Amparo**: texto\n- **Fuerte de Loreto** (historia)\n\nAviso.';
    expect([...previousRecommendationIds(turn(reply), candidates)!]).toEqual([id(100), id(101)]);
  });

  it('sigue leyendo historiales v1 con escapes', () => {
    const reply = `Intro:\n- ${legacyEscaped('Museo *Amparo*')}: texto\n- Fuerte de Loreto\nAviso.`;
    expect([...previousRecommendationIds(turn(reply), candidates)!]).toEqual([id(100), id(101)]);
  });

  it('flujo completo v2: la respuesta del servidor alimenta el seguimiento', async () => {
    records = [record(0, 'Casa del Alfeñique', 'Histórico'), record(1, 'Cantona', 'Arqueológico'), record(2, 'Cholula', 'Arqueológico')];
    records.push({ ...record(3, 'Mixto'), categories: [{ category: { name: 'Histórico' } }, { category: { name: 'Arqueológico' } }] });
    const chat = service();
    const first = await chat.chat({ message: '¿Qué lugares históricos hay en Puebla?' });
    expect(first.places.map(p => p.id)).toEqual([id(100), id(103)]);
    const second = await chat.chat({
      message: '¿Y cuáles de esos son arqueológicos?',
      history: [{ role: 'user', content: '¿Qué lugares históricos hay en Puebla?' }, { role: 'assistant', content: first.reply }],
    });
    expect(second.places.map(p => p.id)).toEqual([id(103)]);
  });
});

describe('errores HTTP con código estable', () => {
  let app: NestExpressApplication;
  let fail = false;
  beforeEach(async () => {
    fail = false;
    const cfg = loadConfig({ GROQ_API_KEY: 'ficticio-provider-key', CHAT_API_KEY: 'llave-correcta', MXGUIDE_API_URL: 'https://catalog.invalid', RATE_LIMIT_PER_MINUTE: '100' });
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG).useValue(cfg)
      .overrideProvider(LLM_PROVIDERS).useValue([{ name: 'groq', isConfigured: () => true, generate: async (r: LlmRequest) => { if (fail) throw Error('stack interno ficticio'); return selectAll(r); } }])
      .compile();
    app = module.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureHttp(app, cfg);
    await app.init();
  });
  afterEach(async () => app.close());

  const post = (body: unknown, key = 'llave-correcta') => request(app.getHttpServer()).post('/chat').set('x-api-key', key).send(body as object);

  it.each([
    ['401', () => post({ message: 'hola' }, 'mala'), 401, 'unauthorized', false],
    ['400 validación', () => post({ message: '   ' }), 400, 'invalid_request', false],
    ['400 campo extra', () => post({ message: 'hola', admin: true }), 400, 'invalid_request', false],
    ['404 ruta', () => request(app.getHttpServer()).get('/no-existe'), 404, 'not_found', false],
  ])('%s', async (_name, call, status, code, retryable) => {
    const res = await (call as () => request.Test)();
    expect(res.status).toBe(status);
    expect(res.body.error).toEqual({ code, message: res.body.message, retryable });
    expect(Object.keys(res.body).sort()).toEqual(['error', 'message', 'statusCode']);
  });

  it('503 de proveedores: unavailable, reintentable y sin detalles internos', async () => {
    fail = true;
    const res = await post({ message: '¿Qué lugares históricos hay en Puebla?' });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatchObject({ code: 'unavailable', retryable: true });
    expect(JSON.stringify(res.body)).not.toMatch(/stack|ficticio|groq/i);
  });
});
