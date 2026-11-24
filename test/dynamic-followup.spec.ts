import { PlacesService } from '../src/places/places.service';
import { ChatService } from '../src/chat/chat.service';
import { LlmRequest } from '../src/chat/providers/llm-provider';
import { loadConfig } from '../src/config/env';
const names=['Aguascalientes','Baja California','Baja California Sur','Campeche','Chiapas','Chihuahua','Ciudad de México','Coahuila','Colima','Durango','Estado de México','Guanajuato','Guerrero','Hidalgo','Jalisco','Michoacán','Morelos','Nayarit','Nuevo León','Oaxaca','Puebla','Querétaro','Quintana Roo','San Luis Potosí','Sinaloa','Sonora','Tabasco','Tamaulipas','Tlaxcala','Veracruz','Yucatán','Zacatecas'];
const id=(n:number)=>`12345678-abcd-4000-8000-${String(n).padStart(12,'0')}`;
const config=loadConfig({GROQ_API_KEY:'ficticio-groq',MXGUIDE_API_URL:'https://catalog.invalid'});
afterEach(()=>jest.restoreAllMocks());
it.each(names)('seguimiento, cambio de estado y cercanía independientes de excepciones: %s',async name=>{
 // IDs intentionally differ from other fixtures and ordering is reversed.
 const states=names.map((name,i)=>({id:id(9000+i),name})).reverse();
 const state=states.find(s=>s.name===name)!;
 const other=states[(states.indexOf(state)+1)%states.length];
 const records=(s:typeof state)=>[0,1,2].map((n)=>({id:id(Number(s.id.slice(-12))*10+n),stateId:s.id,name:`Destino ${n} de ${s.name}`,categories:(n===0?['Histórico']:n===1?['Histórico','Arqueológico']:['Arqueológico']).map(name=>({category:{name}}))}));
 const fetchMock=jest.spyOn(globalThis,'fetch').mockImplementation(async url=>{
  const u=new URL(String(url));
  if(u.origin!=='https://catalog.invalid')throw Error('Unexpected HTTP target');
  const s=states.find(s=>s.id===u.searchParams.get('stateId'));
  const data=u.pathname==='/states'?states:u.pathname==='/places/nearby'?[{id:id(70000),name:'Parque cercano',distanceKm:0}]:s?records(s):[];
  return new Response(JSON.stringify(data));
 });
 const calls:LlmRequest[]=[];
 const service=new ChatService(config,[{name:'groq',isConfigured:()=>true,generate:async r=>{calls.push(r);return JSON.stringify({placeIds:JSON.parse(r.message).candidates.map((p:{id:string})=>p.id).slice(0,5)});}}],new PlacesService(config));
 const firstQuestion=`¿Qué lugares históricos hay en ${name}?`;
 const first=await service.chat({message:firstQuestion});
 expect(first.places.map(p=>p.id)).toEqual(records(state).slice(0,2).map(p=>p.id));
 const history=[{role:'user' as const,content:firstQuestion},{role:'assistant' as const,content:first.reply}];
 const followup='¿Y cuáles de esos son arqueológicos?';
 const second=await service.chat({message:followup,history});
 expect(second.places.map(p=>p.id)).toEqual([records(state)[1].id]);
 expect(JSON.parse(calls.at(-1)!.message).candidates.map((p:{state:string})=>p.state)).toEqual([name]);
 const extended=[...history,{role:'user' as const,content:followup},{role:'assistant' as const,content:second.reply}];
 const there=await service.chat({message:'¿Qué lugares hay allí?',history:extended});
 expect(there.places.map(p=>p.id)).toEqual(records(state).map(p=>p.id));
 const changed=await service.chat({message:`¿Qué zonas arqueológicas hay en ${other.name}?`,history:extended});
 expect(changed.places.map(p=>p.id)).toEqual(records(other).slice(1).map(p=>p.id));
 expect(changed.places.every(p=>p.state===other.name)).toBe(true);
 const location={lat:17.4321123,lng:-94.1234567};
 const near=await service.chat({message:'¿Qué hay cerca de mí?',location,history:extended});
 expect(near.places.map(p=>p.id)).toEqual([id(70000)]);
 const lastUrl=new URL(String(fetchMock.mock.calls.at(-1)![0]));
 expect(lastUrl.pathname).toBe('/places/nearby');expect(lastUrl.searchParams.get('lat')).toBe(String(location.lat));
 expect(JSON.stringify(calls)).not.toMatch(/17\.4321123|94\.1234567/);
 expect(calls.every(r=>r.history.length===0)).toBe(true);
 expect(fetchMock.mock.calls.filter(c=>String(c[0]).endsWith('/states'))).toHaveLength(1);
});

it('no salta conversaciones no relacionadas ni la ventana de 12 turnos; admite estados nuevos del catálogo', async()=>{
 const {resolveHistoryState}=await import('../src/places/state-resolver');
 const state={id:id(99999),name:'Destino de Prueba'};
 expect(resolveHistoryState('¿Qué hay allí?',[{role:'user',content:'Destino de Prueba'}],[state])).toEqual({kind:'state',state});
 expect(resolveHistoryState('¿Qué hay allí?',[{role:'user',content:'Destino de Prueba'},{role:'user',content:'Cambiemos de tema'}],[state]).kind).toBe('general');
 expect(resolveHistoryState('¿Qué hay allí?',[{role:'user',content:'Destino de Prueba'},...Array.from({length:12},()=>({role:'user',content:'¿Y qué otros?'}))],[state]).kind).toBe('general');
});
