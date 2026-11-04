import { PlacesService } from '../src/places/places.service';
import { CatalogState, resolveState } from '../src/places/state-resolver';
import { loadConfig } from '../src/config/env';
import { ChatService } from '../src/chat/chat.service';
import { LlmRequest } from '../src/chat/providers/llm-provider';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const names = ['Aguascalientes', 'Baja California', 'Baja California Sur', 'Campeche', 'Chiapas', 'Chihuahua', 'Ciudad de México', 'Coahuila', 'Colima', 'Durango', 'Estado de México', 'Guanajuato', 'Guerrero', 'Hidalgo', 'Jalisco', 'Michoacán', 'Morelos', 'Nayarit', 'Nuevo León', 'Oaxaca', 'Puebla', 'Querétaro', 'Quintana Roo', 'San Luis Potosí', 'Sinaloa', 'Sonora', 'Tabasco', 'Tamaulipas', 'Tlaxcala', 'Veracruz', 'Yucatán', 'Zacatecas'];
const states: CatalogState[] = names.map((name, i) => ({ id: id(i + 1), name }));
const chiapas = states.find(s => s.name === 'Chiapas')!;
const place = (n: number, extra = {}) => ({ id: id(n + 100), name: `Destino ${n}`, stateId: chiapas.id, categories: [null], ...extra });
const config = loadConfig({ GEMINI_API_KEY: 'fake', MXGUIDE_API_URL: 'https://catalog.invalid' });
let fetchMock: jest.SpyInstance;
function backend(data: unknown = []) {
    fetchMock.mockImplementation(async (url: string) => ({ ok: true, json: async () => url.endsWith('/states') ? states : data }));
    return new PlacesService(config);
}
beforeEach(() => { fetchMock = jest.spyOn(globalThis, 'fetch'); });
afterEach(() => { jest.restoreAllMocks(); });
describe('resolución dinámica', () => {
    it.each(states)('reconoce $name sin acentos y con puntuación', state => {
        const message = state.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/ /g, ',  ');
        expect(resolveState(`¿Qué hay en ${message}?`, states)).toEqual({ kind: 'state', state });
    });
    it.each(['Chiapas y Oaxaca', 'no quiero Chiapas', 'excepto Puebla', 'Chiapas, sin Oaxaca'])('pide precisión: %s', message => {
        expect(resolveState(message, states).kind).toBe('ambiguous');
    });
    it('no convierte México en un estado', () => expect(resolveState('lugares de México', states).kind).toBe('unrecognized'));
    it('resuelve nombres nuevos sin condiciones específicas', () => expect(resolveState('en Estado Nuevo', [{ id: id(999), name: 'Estado Nuevo' }]).kind).toBe('state'));
});
describe('catálogo HTTP simulado', () => {
    it('prioriza estado sobre ubicación, valida pertenencia y limita a 15 únicos', async () => {
        const raw = Array.from({ length: 130 }, (_, i) => place(i));
        const service = backend([place(999, { stateId: id(999) }), ...raw, raw[0], null]);
        const result = await service.getContext({ lat: 19, lng: -99 }, 'Chiapas');
        expect(result).toMatchObject({ status: 'found', mode: 'state', state: chiapas });
        expect(result.places).toHaveLength(15);
        expect(result.places[0]).toMatchObject({ id: raw[0].id, state: 'Chiapas', category: '' });
        expect(fetchMock.mock.calls[1][0]).toBe(`https://catalog.invalid/places?stateId=${chiapas.id}&limit=15`);
    });
    it('selecciona exactamente los 10 más cercanos de 155 resultados desordenados y solo los envía a IA', async () => {
        const raw: unknown[] = Array.from({ length: 130 }, (_, i) => place(i, { distanceKm: Math.floor(i / 2) + 0.001 * (i % 2) }));
        // 15 duplicates, including a lower distance for an existing ID.
        for (let i = 0; i < 15; i++)
            raw.push(place(i, { distanceKm: i === 14 ? 0.0001 : 999 }));
        raw.push(...[undefined, null, '', '0', -1, Infinity, NaN, false].map((distanceKm, i) => place(500 + i, { distanceKm })));
        raw.push(place(600, { id: 'invalid', distanceKm: 0 }), place(601, { id: '', distanceKm: 0 }));
        expect(raw).toHaveLength(155);
        raw.reverse();
        const service = backend(raw);
        const expected = [0, 14, 1, 2, 3, 4, 5, 6, 7, 8].map(n => id(n + 100));
        const context = await service.getContext({ lat: 19, lng: -99 }, 'cerca de mí');
        expect(context.places.map(p => p.id)).toEqual(expected);
        expect(context.places).toHaveLength(10);
        expect(context.places[1].distanceKm).toBe(0.0001);
        const requests: LlmRequest[] = [];
        const chat = new ChatService(config, [{ name: 'gemini', isConfigured: () => true, generate: async (r) => { requests.push(r); return JSON.stringify({placeIds:[id(114)]}); } }], service);
        const response = await chat.chat({ message: 'cerca de mí', location: { lat: 19, lng: -99 } });
        expect(JSON.parse(requests[0].message).candidates).toHaveLength(10);
        expect(response.places.map(p => p.id)).toEqual([id(114)]);
        expect(JSON.parse(requests[0].message).candidates.map((p: {id:string})=>p.id)).toEqual(expected);
    });
    it('desempata por ID sin redondear distancias', async () => {
        const result = await backend([place(2, { distanceKm: 1 }), place(1, { distanceKm: 1 }), place(3, { distanceKm: 0.99999 })]).getContext({ lat: 0, lng: 0 }, 'cerca de mi');
        expect(result.places.map(p => p.id)).toEqual([id(103), id(101), id(102)]);
    });
    it('no inventa distancias y distingue registros inutilizables de una consulta vacía', async () => {
        expect(PlacesService.toSummary(place(1, { distanceKm: null }))?.distanceKm).toBeUndefined();
        expect((await backend([place(1)]).getContext({ lat: 0, lng: 0 }, 'cerca de mi')).status).toBe('malformed');
        expect((await backend([]).getContext(undefined, 'Chiapas')).status).toBe('empty');
    });
    it('solicita coordenadas sin consultar nearby', async () => {
        expect((await backend().getContext(undefined, 'cerca de mí')).status).toBe('missing-location');
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    it('mantiene destacados y cercanos con ubicación opcional', async () => {
        const service = backend([place(1, { distanceKm: 2 })]);
        expect((await service.getContext(undefined, 'Hola')).mode).toBe('featured');
        expect((await service.getContext({ lat: 0, lng: 0 }, 'Hola')).mode).toBe('nearby');
    });
    it('usa solo una continuación inequívoca del usuario y prioriza el mensaje actual', async () => {
        const service = backend([]);
        expect((await service.getContext(undefined, '¿y cuáles recomiendas?', [{ role: 'user', content: 'Chiapas' }])).state?.name).toBe('Chiapas');
        expect((await service.getContext(undefined, 'Oaxaca', [{ role: 'user', content: 'Chiapas' }])).state?.name).toBe('Oaxaca');
        expect((await service.getContext(undefined, '¿y cuáles?', [{ role: 'assistant', content: 'Chiapas' }])).mode).toBe('featured');
    });
    it('comparte el refresco concurrente y renueva la caché vencida', async () => {
        const clock = jest.spyOn(Date, 'now').mockReturnValue(1000);
        const service = backend([]);
        await Promise.all([service.getContext(undefined, 'Chiapas'), service.getContext(undefined, 'Oaxaca')]);
        expect(fetchMock.mock.calls.filter(c => String(c[0]).endsWith('/states'))).toHaveLength(1);
        clock.mockReturnValue(601001);
        await service.getContext(undefined, 'Puebla');
        expect(fetchMock.mock.calls.filter(c => String(c[0]).endsWith('/states'))).toHaveLength(2);
    });
    it.each(['http', 'timeout', 'connection', 'malformed'] as const)('distingue %s sin llamar a IA ni sustituir el estado', async (status) => {
        const service = backend();
        fetchMock.mockImplementation(async (url: string) => {
            if (url.endsWith('/states'))
                return { ok: true, json: async () => states };
            if (status === 'http')
                return { ok: false, status: 500 };
            if (status === 'timeout')
                throw new DOMException('timeout', 'TimeoutError');
            if (status === 'connection')
                throw new TypeError('network');
            return { ok: true, json: async () => { throw new SyntaxError('invalid JSON'); } };
        });
        expect((await service.getContext(undefined, 'Chiapas')).status).toBe(status);
        const generate = jest.fn();
        const result = await new ChatService(config, [{ name: 'gemini', isConfigured: () => true, generate }], service).chat({ message: 'Chiapas' });
        expect(generate).not.toHaveBeenCalled();
        expect(result.places).toEqual([]);
        expect(result.reply).toContain('No pude consultar');
    });
    it('rechaza envoltorios no verificados y configuración ausente', async () => {
        expect((await backend({ data: [] }).getContext(undefined, 'Chiapas')).status).toBe('malformed');
        expect((await new PlacesService(loadConfig({ GEMINI_API_KEY: 'fake' })).getContext()).status).toBe('unconfigured');
    });
    it('omite asociaciones de tarjetas con nombres ambiguos', () => {
        const a = PlacesService.toSummary(place(1))!;
        expect(ChatService.mentionedPlaces('Destino 1', [a, { ...a, id: id(999) }])).toEqual([]);
    });
});
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { APP_CONFIG } from '../src/config/env';
import { LLM_PROVIDERS } from '../src/chat/providers/llm-provider';
describe('POST /chat con catálogo simulado y PlacesService real', () => {
    it('conserva contrato y tarjetas territoriales; pide ubicación sin invocar IA', async () => {
        backend([place(1)]);
        const generate = jest.fn(async () => 'Visita Destino 1.');
        const module = await Test.createTestingModule({ imports: [AppModule] })
            .overrideProvider(APP_CONFIG).useValue(config)
            .overrideProvider(LLM_PROVIDERS).useValue([{ name: 'gemini', isConfigured: () => true, generate }]).compile();
        const app = module.createNestApplication();
        app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
        await app.init();
        try {
            const res = await request(app.getHttpServer()).post('/chat').send({ message: 'Chiapas', location: { lat: 19, lng: -99 } }).expect(200);
            expect(Object.keys(res.body).sort()).toEqual(['places', 'provider', 'reply', 'suggestions']);
            expect(res.body.places[0]).toMatchObject({ id: id(101), state: 'Chiapas' });
            expect(res.body.provider).toBe('gemini');
            expect(res.body.suggestions[0]).not.toBe('Más lugares cerca');
            const missing = await request(app.getHttpServer()).post('/chat').send({ message: 'cerca de mí' }).expect(200);
            expect(missing.body.reply).toContain('Comparte tu ubicación');
            expect(missing.body.places).toEqual([]);
            expect(generate).toHaveBeenCalledTimes(1);
        }
        finally {
            await app.close();
        }
    });
});
