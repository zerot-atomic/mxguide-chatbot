import { PlacesService } from '../src/places/places.service';
import { ChatService } from '../src/chat/chat.service';
import { LlmRequest } from '../src/chat/providers/llm-provider';
import { loadConfig } from '../src/config/env';
import { directItinerary } from '../src/places/itinerary';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const states=['Puebla','Oaxaca','Veracruz','Chiapas','Yucatán'].map((name,i)=>({name,id:id(i+1)}));
const config=loadConfig({GROQ_API_KEY:'ficticio-groq',MXGUIDE_API_URL:'https://catalog.invalid'});
const categories=(...names:string[])=>names.map(name=>({category:{name}}));
const record=(n:number,...names:string[])=>({id:id(100+n),name:`Destino ${n}`,shortDescription:n===0?'Arquitectura colonial.':'',categories:categories(...names)});
let records:ReturnType<typeof record>[];
let calls:LlmRequest[];
let output:string|undefined;
let fetchMock:jest.SpyInstance;
let chat:ChatService;
beforeEach(()=>{
 records=[record(0,'Histórico'),record(1,'Cultural'),record(2,'Arqueológico'),record(3,'Natural'),record(4,'Religioso'),record(5,'Hospedaje'),record(6,'Gastronomía'),record(7,'Cultural','Hospedaje')];calls=[];output=undefined;
 fetchMock=jest.spyOn(globalThis,'fetch').mockImplementation(async url=>{
  const u=new URL(String(url));if(u.origin!=='https://catalog.invalid')throw Error('Unexpected target');
  return new Response(JSON.stringify(u.pathname==='/states'?states:records.map(p=>({...p,stateId:u.searchParams.get('stateId')}))));
 });
 chat=new ChatService(config,[{name:'groq',isConfigured:()=>true,generate:async r=>{calls.push(r);return output??JSON.stringify({placeIds:JSON.parse(r.message).candidates.map((p:{id:string})=>p.id).slice(0,5)});}}],new PlacesService(config));
});
afterEach(()=>jest.restoreAllMocks());
it.each(['Arma mi itinerario','Organízame un itinerario de un día para conocer Puebla','Hazme un itinerario turístico en Oaxaca','Planea una visita para conocer Veracruz','Quiero un recorrido cultural por Chiapas','Prepárame un plan para visitar lugares históricos de Yucatán'])('detecta solicitud %s',text=>expect(directItinerary(text)).toBe(true));
it.each(states)('itinerario general dinámico y cinco paradas seguras en $name',async state=>{
 const result=await chat.chat({message:`Organízame un itinerario de un día para conocer ${state.name}`});
 expect(result.reply).toContain(`Itinerario sugerido para conocer ${state.name}`);
 expect(result.places.map(p=>p.id)).toEqual([0,1,2,3,4].map(n=>id(100+n)));
 expect(result.places.every(p=>p.state===state.name)).toBe(true);
 const lines=result.reply.split('\n').filter(l=>/^\d+\. /.test(l));
 expect(lines.map((line,i)=>line.startsWith(`${i+1}. ${result.places[i].name}`))).toEqual([true,true,true,true,true]);
 expect(result.reply).toContain('Arquitectura colonial.');
 expect(result.reply).toContain('no representa una ruta optimizada');
 expect(result.reply).not.toMatch(/\b\d{1,2}:\d{2}\b|\d+ km|minutos de traslado|entrada gratis/);
 expect(result.reply).toContain('no garantiza que puedas visitar todas las paradas');
 expect(Object.keys(result).sort()).toEqual(['places','provider','reply','suggestions']);
 expect(JSON.parse(calls[0].message).candidates).toHaveLength(5);expect(calls[0].history).toEqual([]);
 expect(String(fetchMock.mock.calls[1][0])).toContain(`stateId=${state.id}&limit=100`);
});
it('Arma mi itinerario hereda estado y categoría histórica sin compartir historial',async()=>{
 const first=await chat.chat({message:'¿Qué lugares históricos hay en Oaxaca?'});
 const result=await chat.chat({message:'Arma mi itinerario',history:[{role:'user',content:'¿Qué lugares históricos hay en Oaxaca?'},{role:'assistant',content:first.reply}]});
 expect(result.reply).toContain('Itinerario sugerido para conocer Oaxaca');
 expect(result.places.map(p=>p.id)).toEqual([id(100)]);expect(JSON.stringify(calls.at(-1))).not.toContain(first.reply);
});
it('conserva formato de itinerario en «Y uno cultural» y cambia estado explícito en «Y en Chiapas»',async()=>{
 const firstQuestion='Organízame un itinerario en Puebla';const first=await chat.chat({message:firstQuestion});
 const history=[{role:'user' as const,content:firstQuestion},{role:'assistant' as const,content:first.reply}];
 const second=await chat.chat({message:'¿Y uno cultural?',history});
 expect(second.reply).toContain('Itinerario sugerido para conocer Puebla');expect(second.places.map(p=>p.id)).toEqual([id(101)]);
 const next=await chat.chat({message:'¿Y en Chiapas?',history:[...history,{role:'user',content:'¿Y uno cultural?'},{role:'assistant',content:second.reply}]});
 expect(next.reply).toContain('Itinerario sugerido para conocer Chiapas');expect(next.places[0].state).toBe('Chiapas');expect(next.places.map(p=>p.id)).toEqual([id(101)]);
});
it('cambia de Veracruz a Chiapas en la misma conversación sin estado fijo',async()=>{
 const result=await chat.chat({message:'¿Y en Chiapas?',history:[{role:'user',content:'Hazme un itinerario en Veracruz'},{role:'assistant',content:'1. Destino 0'}]});
 expect(result.reply).toContain('Itinerario sugerido para conocer Chiapas');expect(result.places.every(p=>p.state==='Chiapas')).toBe(true);
});
it.each([undefined,{lat:19,lng:-99}])('sin estado ni historial solicita destino incluso si hay ubicación',async location=>{
 const result=await chat.chat({message:'Arma mi itinerario',location});expect(result.reply).toContain('Qué estado');expect(result.places).toEqual([]);expect(calls).toHaveLength(0);expect(fetchMock).toHaveBeenCalledTimes(1);
});
it.each(['Quiero un recorrido cultural por Chiapas','Prepárame un plan para visitar lugares históricos de Yucatán'])('respeta categoría explícita sin paradas hoteleras: %s',async message=>{
 const result=await chat.chat({message});expect(result.places).toHaveLength(1);expect(result.places[0].id).toBe(message.includes('cultural')?id(101):id(100));
});
it.each([JSON.stringify({placeIds:[id(100),id(999)]}),JSON.stringify({placeIds:[id(100),id(100)]}),'Museo inventado, abierto 24 horas'])('rechaza salida inválida sin prosa ni reintentos: %s',async invalid=>{
 output=invalid;const result=await chat.chat({message:'itinerario en Puebla'});expect(result.places.map(p=>p.id)).toEqual([id(100),id(101),id(102)]);expect(result.reply).not.toMatch(/inventado|24 horas/);expect(calls).toHaveLength(1);expect(result.reply).toContain('1. Destino 0');
});
it('pocas paradas y descripciones ausentes no se completan inventando destinos',async()=>{
 records=[record(2,'Arqueológico')];const result=await chat.chat({message:'itinerario en Puebla'});expect(result.places).toHaveLength(1);expect(result.reply).toContain('1. Destino 2');expect(result.reply).not.toContain('2. ');
});
it('sin coincidencias devuelve aviso local y no IA',async()=>{
 records=[record(5,'Hospedaje'),record(6,'Gastronomía')];const result=await chat.chat({message:'itinerario en Puebla'});expect(result.places).toEqual([]);expect(result.reply).toContain('entre los registros recibidos');expect(calls).toHaveLength(0);
});
it('gastronomía no se transforma en paradas visitables sin subtipo confirmado',async()=>{
 const result=await chat.chat({message:'itinerario gastronómico en Puebla'});expect(result.reply).toContain('no distingue restaurantes de platillos');expect(result.places).toEqual([]);expect(calls).toHaveLength(0);
});
it('hospedaje explícito se limita a asociaciones verificadas',async()=>{
 const result=await chat.chat({message:'itinerario de hospedaje en Puebla'});expect(result.places.map(p=>p.id)).toEqual([id(105),id(107)]);
});
it('de esos interpreta la lista numerada sin cambiar identidad de tarjetas',async()=>{
 const firstQuestion='itinerario en Puebla';const first=await chat.chat({message:firstQuestion});
 const next=await chat.chat({message:'¿Y cuáles de esos son arqueológicos?',history:[{role:'user',content:firstQuestion},{role:'assistant',content:first.reply}]});
 expect(next.places.map(p=>p.id)).toEqual([id(102)]);expect(next.reply).toContain('1. Destino 2');
});
it('peticiones normales tras un itinerario no heredan el modo de presentación',async()=>{
 const result=await chat.chat({message:'¿Qué lugares culturales hay en Oaxaca?',history:[{role:'user',content:'itinerario en Puebla'}]});expect(result.reply).not.toContain('Itinerario sugerido');
});
