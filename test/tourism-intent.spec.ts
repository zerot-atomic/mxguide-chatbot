import { classifyIntent, matchesIntent, categoryNames, intentInstruction, Intent } from '../src/places/tourism-intent';
import { PlacesService } from '../src/places/places.service';
import { ChatService } from '../src/chat/chat.service';
import { loadConfig } from '../src/config/env';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const state = { id: id(1), name: 'Chiapas' };
const config = loadConfig({ GEMINI_API_KEY: 'fake', MXGUIDE_API_URL: 'https://catalog.invalid' });
const categories = (...names: string[]) => names.map(name => ({ category: { name } }));
const place = (n: number, ...names: string[]) => ({ id: id(n + 100), name: `Registro ${n}`, stateId: state.id, distanceKm: n, categories: categories(...names) });
let fetchMock: jest.SpyInstance;
beforeEach(() => { fetchMock = jest.spyOn(globalThis, 'fetch'); });
afterEach(() => jest.restoreAllMocks());
function backend(raw: unknown[]) {
  fetchMock.mockImplementation(async (url: string) => ({ ok: true, json: async () => url.endsWith('/states') ? [state] : raw }));
  return new PlacesService(config);
}
it.each<[string, Intent]>([
 ['atractivos históricos', 'historic'], ['zonas arqueológicas', 'archaeology'], ['museos', 'culture'],
 ['atractivos naturales', 'nature'], ['lugares religiosos', 'religion'], ['hospedaje', 'lodging'],
 ['gastronomía', 'gastronomy'], ['restaurantes', 'restaurants'], ['comida típica', 'dishes'],
 ['¿Qué hay cerca de mí?', 'general'], ['atracciones turísticas cerca', 'attractions'],
 ['mensaje desconocido', 'general'], ['hoteles y museos', 'ambiguous'], ['sin hoteles', 'ambiguous'],
])('clasifica %s', (message, intent) => expect(classifyIntent(message)).toBe(intent));
it('usa todas las asociaciones sin atribuir categorías por nombre', () => {
 expect(matchesIntent(place(1, 'Hospedaje', 'Cultural'), 'culture')).toBe(true);
 expect(matchesIntent(place(1, 'Hospedaje', 'Cultural'), 'attractions')).toBe(false);
 expect(matchesIntent({ name: 'Museo', categories: null }, 'culture')).toBe(false);
 expect(categoryNames({ categories: [null, {}, ...categories('Natural', 'Natural')] })).toEqual(['Natural']);
 expect(PlacesService.toSummary(place(1, 'Natural', 'Cultural'))?.category).toBe('Natural · Cultural');
});
it.each<[string, string]>([['históricos','Histórico'],['arqueología','Arqueológico'],['museos','Cultural'],['naturales','Natural'],['religiosos','Religioso'],['hospedaje','Hospedaje'],['gastronomía','Gastronomía'],['restaurantes','Gastronomía'],['comida típica','Gastronomía']])('filtra %s manteniendo el estado', async (message, category) => {
 const result = await backend([place(1, category), place(2, 'Desconocida'), {...place(3, category), stateId: id(999)}, {...place(4), categories: [null]}]).getContext({ lat: 19, lng: -99 }, `${message} en Chiapas`);
 expect(result.mode).toBe('state'); expect(result.places.map(p => p.id)).toEqual([id(101)]);
 expect(fetchMock.mock.calls[1][0]).toContain(`stateId=${state.id}&limit=100`);
});
it('filtra antes del Top 10 con categorías enriquecidas simuladas; no implica soporte real de nearby', async () => {
 const raw = Array.from({ length: 155 }, (_, i) => place(i, i < 30 ? 'Hospedaje' : 'Natural')).reverse();
 raw.push(place(30, 'Natural'));
 const service = backend(raw);
 const result = await service.getContext({lat: 0, lng: 0}, 'atracciones turísticas cerca');
 expect(result.places.map(p => p.id)).toEqual(Array.from({length: 10}, (_, i) => id(130+i)));
 const generate = jest.fn(async () => JSON.stringify({placeIds:[id(130)]}));
 const chat = await new ChatService(config, [{name:'gemini',isConfigured:()=>true,generate}], service).chat({message:'atracciones turísticas cerca',location:{lat:0,lng:0}});
 expect(generate.mock.calls).toHaveLength(1);
 expect(chat.places[0].id).toBe(id(130));
 expect(Object.keys(chat).sort()).toEqual(['places','provider','reply','suggestions']);
});
it('nearby real sin categorías informa limitación sin N+1 ni IA; general sigue funcionando', async () => {
 const raw = [place(1), place(2)].map(({categories: ignored, ...p}) => p);
 const service = backend(raw);
 expect((await service.getContext({lat:0,lng:0},'atracciones turísticas cerca')).status).toBe('categories-unavailable');
 expect(fetchMock).toHaveBeenCalledTimes(2);
 const generate = jest.fn();
 const result = await new ChatService(config,[{name:'gemini',isConfigured:()=>true,generate}],service).chat({message:'museos cerca',location:{lat:0,lng:0}});
 expect(result.reply).toContain('no permite confirmar'); expect(generate).not.toHaveBeenCalled();
 expect((await service.getContext({lat:0,lng:0},'¿Qué hay cerca de mí?')).places).toHaveLength(2);
});
it('cero coincidencias no significa ausencia en toda la base; cache no mezcla intenciones', async () => {
 const service = backend([place(1,'Hospedaje'),place(2,'Cultural')]);
 expect((await service.getContext(undefined,'hospedaje')).places[0].id).toBe(id(101));
 expect((await service.getContext(undefined,'museos')).places[0].id).toBe(id(102));
 expect((await service.getContext(undefined,'naturaleza')).status).toBe('empty');
 expect(fetchMock).toHaveBeenCalledTimes(2);
});
it('hospedaje no se presenta como monumento y gastronomía no confirma restaurantes', () => {
 expect(intentInstruction('lodging')).toContain('alojamiento');
 expect(intentInstruction('restaurants')).toContain('no distingue restaurantes de platillos');
 expect(intentInstruction('dishes')).toContain('no afirmes');
});

it('regresión Puebla: comida típica fuera de los primeros 15 se recupera entre 100, pero solo envía 15 únicos a IA', async () => {
 const puebla = { id: id(2), name: 'Puebla' };
 const raw = Array.from({ length: 100 }, (_, i) => ({
   ...place(i, i >= 15 && i < 40 ? 'Gastronomía' : 'Histórico'), stateId: puebla.id,
 }));
 // A duplicate in the gastronomic portion must not consume a candidate slot.
 raw[16] = { ...raw[15] };
 expect(raw.slice(0, 15).some(p => matchesIntent(p, 'dishes'))).toBe(false);
 expect(raw.slice(15).some(p => matchesIntent(p, 'dishes'))).toBe(true);
 fetchMock.mockImplementation(async (url: string) => {
   const parsed = new URL(url);
   return { ok: true, json: async () => parsed.pathname === '/states' ? [puebla] : raw.slice(0, Number(parsed.searchParams.get('limit'))) };
 });
 const service = new PlacesService(config);
 const message = '¿Qué comida típica puedo encontrar en Puebla?';
 expect(classifyIntent(message)).toBe('dishes');
 const context = await service.getContext(undefined, message);
 const expected = [15, ...Array.from({ length: 14 }, (_, i) => i + 17)].map(n => id(n + 100));
 expect(context.status).toBe('found');
 expect(context.places.map(p => p.id)).toEqual(expected);
 expect(context.places.every(p => p.category === 'Gastronomía' && p.state === 'Puebla')).toBe(true);
 expect(fetchMock.mock.calls[1][0]).toBe(`https://catalog.invalid/places?stateId=${puebla.id}&limit=100`);
 const requests: import('../src/chat/providers/llm-provider').LlmRequest[] = [];
 const chat = new ChatService(config, [{ name: 'gemini', isConfigured: () => true, generate: async r => { requests.push(r); return JSON.stringify({placeIds:[id(115)]}); } }], service);
 const response = await chat.chat({message});
 const lines = requests[0].system.split('\n').filter(line => line.startsWith('- Registro '));
 expect(lines).toHaveLength(15);
 expect(lines).toEqual(context.places.map(p => `- ${p.name} (${p.category} · Puebla · a ${p.distanceKm} km)`));
 expect(response.places.map(p => p.id)).toEqual([id(115)]);
 expect(Object.keys(response).sort()).toEqual(['places', 'provider', 'reply', 'suggestions']);
 // General queries keep the original recovery size, even in the same service instance.
 await service.getContext(undefined, '¿Qué lugares hay en Puebla?');
 expect(fetchMock.mock.calls.at(-1)![0]).toBe(`https://catalog.invalid/places?stateId=${puebla.id}&limit=15`);
});

it('no interpreta cero coincidencias en la muestra estatal como ausencia en todo el catálogo', async () => {
 const service = backend(Array.from({length:100},(_,i)=>place(i,'Histórico')));
 const generate = jest.fn();
 const result = await new ChatService(config,[{name:'gemini',isConfigured:()=>true,generate}],service).chat({message:'comida típica en Chiapas'});
 expect(result.reply).toContain('entre los registros recibidos');
 expect(result.places).toEqual([]);
 expect(generate).not.toHaveBeenCalled();
 expect(fetchMock.mock.calls[1][0]).toContain('limit=100');
});
