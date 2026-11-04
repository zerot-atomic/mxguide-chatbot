import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { APP_CONFIG, loadConfig } from '../src/config/env';
import { LLM_PROVIDERS, LlmRequest } from '../src/chat/providers/llm-provider';
import { configureHttp } from '../src/common/configure-http';
const id='00000000-0000-4000-8000-000000000101';
const state={id:'00000000-0000-4000-8000-000000000001',name:'Puebla'};
const raw={id,name:'Centro Histórico de ejemplo',stateId:state.id,shortDescription:'Conjunto de arquitectura colonial.',categories:[{category:{name:'Histórico'}}]};
let app:NestExpressApplication;
let mock:jest.SpyInstance;
let fail=false;
let empty=false;
let calls:LlmRequest[];
async function start(key?:string,rate=100){
 fail=false;empty=false;calls=[];
 mock=jest.spyOn(globalThis,'fetch').mockImplementation(async url=>{
  const u=new URL(String(url));if(u.origin!=='https://catalog.invalid')throw Error('No external network allowed');
  return new Response(JSON.stringify(u.pathname==='/states'?[state]:empty?[]:u.pathname==='/places/nearby'?[{id,name:'Parque cercano de ejemplo',distanceKm:0.40195408529000004}]:[raw]));
 });
 const config=loadConfig({GROQ_API_KEY:'ficticio-provider-key',CHAT_API_KEY:key,MXGUIDE_API_URL:'https://catalog.invalid',RATE_LIMIT_PER_MINUTE:String(rate)});
 const module=await Test.createTestingModule({imports:[AppModule]}).overrideProvider(APP_CONFIG).useValue(config).overrideProvider(LLM_PROVIDERS).useValue([{name:'groq',isConfigured:()=>true,generate:async(r:LlmRequest)=>{calls.push(r);if(fail)throw Error('internal fictitious stack');return JSON.stringify({placeIds:JSON.parse(r.message).candidates.map((p:{id:string})=>p.id).slice(0,5)});}}]).compile();
 app=module.createNestApplication<NestExpressApplication>({bodyParser:false});configureHttp(app,config);await app.init();
}
afterEach(async()=>{await app?.close();jest.restoreAllMocks();});
function assertContract(body:Record<string,unknown>){
 expect(Object.keys(body).sort()).toEqual(['places','provider','reply','suggestions']);expect(typeof body.reply).toBe('string');
 expect(['groq','gemini']).toContain(body.provider);expect(Array.isArray(body.places)).toBe(true);
 expect(Array.isArray(body.suggestions)).toBe(true);expect((body.suggestions as unknown[]).every(s=>typeof s==='string')).toBe(true);
}
it('petición mínima y respuesta con tarjeta conservan contrato y campos opcionales',async()=>{
 await start();const res=await request(app.getHttpServer()).post('/chat').send({message:'Hola'}).expect(200);
 assertContract(res.body);expect(res.body.places).toEqual([{id,name:raw.name,state:'Puebla',category:'Histórico',description:raw.shortDescription}]);
 expect(res.body.places[0]).not.toHaveProperty('distanceKm');expect(calls).toHaveLength(1);
});
it('acepta petición completa con historial y nombre; navega por UUID sin inventar URLs',async()=>{
 await start();const res=await request(app.getHttpServer()).post('/chat').send({message:'¿Qué lugares históricos hay en Puebla?',history:[{role:'user',content:'Me interesa Puebla'},{role:'assistant',content:'¿Qué te gustaría conocer?'}],userName:'Ana'}).expect(200);
 assertContract(res.body);expect(res.body.reply).toMatch(/^¡Hola, Ana!/);expect(res.body.places[0].id).toBe(id);
 expect(res.body.places[0]).not.toHaveProperty('url');expect(calls[0].history).toEqual([]);
});
it('nearby conserva double completo en tarjeta y solo redondea reply',async()=>{
 await start();const res=await request(app.getHttpServer()).post('/chat').send({message:'¿Qué hay cerca de mí?',location:{lat:19.0414,lng:-98.2063},history:[]}).expect(200);
 assertContract(res.body);expect(res.body.reply).toContain('0.40 km');expect(res.body.places[0].distanceKm).toBe(0.40195408529000004);
 const url=new URL(String(mock.mock.calls.at(-1)![0]));expect(url.pathname).toBe('/places/nearby');expect(url.searchParams.get('lat')).toBe('19.0414');
});
it('aviso local sin tarjetas tiene el mismo contrato y provider seleccionado sin llamada',async()=>{
 await start();const res=await request(app.getHttpServer()).post('/chat').send({message:'¿Qué hay cerca de mí?'}).expect(200);
 assertContract(res.body);expect(res.body.places).toEqual([]);expect(res.body.reply).toContain('Comparte tu ubicación');expect(res.body.provider).toBe('groq');expect(calls).toHaveLength(0);
});
it('consulta vacía válida es 200 con places vacío, no un error HTTP',async()=>{
 await start();empty=true;const res=await request(app.getHttpServer()).post('/chat').send({message:'Puebla'}).expect(200);
 assertContract(res.body);expect(res.body.places).toEqual([]);expect(calls).toHaveLength(0);
});
it('400 y 401 tienen exactamente statusCode y message sanitizados',async()=>{
 await start('ficticio-shared-key');
 const badKey=await request(app.getHttpServer()).post('/chat').send({message:'hola'}).expect(401);
 expect(badKey.body).toEqual({statusCode:401,message:'API key inválida'});
 const badBody=await request(app.getHttpServer()).post('/chat').set('x-api-key','ficticio-shared-key').send({message:' '}).expect(400);
 expect(badBody.body).toEqual({statusCode:400,message:'Solicitud inválida.'});
});
it('429 conserva el error HTTP diferenciado de un aviso local',async()=>{
 await start(undefined,1);await request(app.getHttpServer()).post('/chat').send({message:'hola'}).expect(200);
 const res=await request(app.getHttpServer()).post('/chat').send({message:'hola'}).expect(429);
 expect(res.body).toEqual({statusCode:429,message:'Demasiadas solicitudes. Intenta de nuevo en un momento.'});
});
it('503 no expone errores del proveedor ni una respuesta de chat falsa',async()=>{
 await start();fail=true;const res=await request(app.getHttpServer()).post('/chat').send({message:'hola'}).expect(503);
 expect(res.body).toEqual({statusCode:503,message:'El asistente no está disponible en este momento.'});
});
