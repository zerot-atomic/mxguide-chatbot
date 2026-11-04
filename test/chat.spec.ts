import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { ChatService } from '../src/chat/chat.service';
import { GeminiProvider } from '../src/chat/providers/gemini.provider';
import { GroqProvider } from '../src/chat/providers/groq.provider';
import { LLM_PROVIDERS, LlmProvider, ProviderError } from '../src/chat/providers/llm-provider';
import { APP_CONFIG, AppConfig, loadConfig } from '../src/config/env';
import { PlacesService } from '../src/places/places.service';

const baseEnv = { GEMINI_API_KEY: 'g-key', GROQ_API_KEY: 'q-key' };

function fakeProvider(name: 'gemini' | 'groq', behavior: () => Promise<string>): LlmProvider & { calls: number } {
  const provider = {
    name,
    calls: 0,
    isConfigured: () => true,
    generate: async () => {
      provider.calls++;
      return behavior();
    },
  };
  return provider;
}

const noPlaces = { getContext: async () => [] } as unknown as PlacesService;

describe('loadConfig', () => {
  it('exige al menos una llave de IA', () => {
    expect(() => loadConfig({})).toThrow(/GROQ_API_KEY/);
  });

  it('usa valores por defecto razonables', () => {
    const config = loadConfig(baseEnv);
    expect(config.primaryProvider).toBe('gemini');
    expect(config.strategy).toBe('fallback');
    expect(config.port).toBe(3000);
  });

  it('rechaza valores inválidos', () => {
    expect(() => loadConfig({ ...baseEnv, CHAT_STRATEGY: 'magia' })).toThrow(/CHAT_STRATEGY/);
    expect(() => loadConfig({ ...baseEnv, PORT: 'abc' })).toThrow(/PORT/);
  });
});

describe('extracción de texto de cada proveedor', () => {
  it('Gemini: junta las partes e ignora el "pensamiento"', () => {
    const text = GeminiProvider.extractText({
      candidates: [{ content: { parts: [{ text: 'pensando…', thought: true }, { text: 'Hola ' }, { text: 'viajero' }] } }],
    });
    expect(text).toBe('Hola viajero');
  });

  it('Gemini: falla si el mensaje fue bloqueado', () => {
    expect(() => GeminiProvider.extractText({ promptFeedback: { blockReason: 'SAFETY' } })).toThrow(ProviderError);
  });

  it('Groq: lee choices[0].message.content', () => {
    expect(GroqProvider.extractText({ choices: [{ message: { content: ' Hola ' } }] })).toBe('Hola');
  });

  it('Groq: falla con respuesta vacía', () => {
    expect(() => GroqProvider.extractText({ choices: [{ message: { content: null } }] })).toThrow(ProviderError);
  });
});

describe('ChatService (orquestador)', () => {
  const dto = { message: '¿Qué visito en Puebla?' };

  it('fallback: si el principal falla, responde el otro', async () => {
    const config = loadConfig(baseEnv);
    const gemini = fakeProvider('gemini', async () => {
      throw new ProviderError('gemini', 'HTTP 500');
    });
    const groq = fakeProvider('groq', async () => 'Te recomiendo la Catedral de Puebla.');
    const service = new ChatService(config, [groq, gemini], noPlaces);

    const result = await service.chat(dto);
    expect(result.provider).toBe('groq');
    expect(gemini.calls).toBe(1);
  });

  it('fallback: usa primero el PRIMARY_PROVIDER aunque venga después en la lista', async () => {
    const config = loadConfig({ ...baseEnv, PRIMARY_PROVIDER: 'groq' });
    const gemini = fakeProvider('gemini', async () => 'gemini');
    const groq = fakeProvider('groq', async () => 'groq');
    const service = new ChatService(config, [gemini, groq], noPlaces);

    expect((await service.chat(dto)).provider).toBe('groq');
    expect(gemini.calls).toBe(0);
  });

  it('race: se queda con la primera respuesta válida', async () => {
    const config = loadConfig({ ...baseEnv, CHAT_STRATEGY: 'race' });
    const slow = fakeProvider('gemini', () => new Promise((r) => setTimeout(() => r('lento'), 50)));
    const fast = fakeProvider('groq', async () => 'rápido');
    const service = new ChatService(config, [slow, fast], noPlaces);

    expect((await service.chat(dto)).reply).toBe('rápido');
  });

  it('responde 503 si fallan todos', async () => {
    const config = loadConfig(baseEnv);
    const broken = async () => {
      throw new ProviderError('gemini', 'caído');
    };
    const service = new ChatService(config, [fakeProvider('gemini', broken), fakeProvider('groq', broken)], noPlaces);
    await expect(service.chat(dto)).rejects.toMatchObject({ status: 503 });
  });

  it('regresa como tarjetas los lugares del catálogo que menciona la respuesta', () => {
    const places = [
      { id: '1', name: 'Catedral de Puebla', state: 'Puebla', category: 'Histórico', description: '' },
      { id: '2', name: 'Chichén Itzá', state: 'Yucatán', category: 'Arqueológico', description: '' },
    ];
    const found = ChatService.mentionedPlaces('Visita la catedral de Puebla y luego Chichen Itza.', places);
    expect(found.map((p) => p.id)).toEqual(['1', '2']);
  });
});

describe('PlacesService.toSummary', () => {
  it('convierte un lugar de la API de MXGuide', () => {
    const summary = PlacesService.toSummary({
      id: 'abc',
      name: 'Cuetzalan',
      shortDescription: 'Pueblo Mágico en la sierra',
      state: { name: 'Puebla' },
      categories: [{ category: { name: 'Natural' } }],
      distanceKm: 12.345,
    });
    expect(summary).toEqual({
      id: 'abc',
      name: 'Cuetzalan',
      state: 'Puebla',
      category: 'Natural',
      description: 'Pueblo Mágico en la sierra',
      distanceKm: 12.3,
    });
  });

  it('descarta basura', () => {
    expect(PlacesService.toSummary(null)).toBeNull();
    expect(PlacesService.toSummary({ name: 'sin id' })).toBeNull();
  });
});

describe('API HTTP', () => {
  let app: INestApplication;
  const reply = fakeProvider('gemini', async () => '¡Hola! Soy Mitlan.');

  async function createApp(env: Record<string, string>) {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue(loadConfig({ ...baseEnv, ...env }) satisfies AppConfig)
      .overrideProvider(LLM_PROVIDERS)
      .useValue([reply])
      .compile();
    const nestApp = moduleRef.createNestApplication();
    nestApp.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await nestApp.init();
    return nestApp;
  }

  afterEach(async () => {
    await app?.close();
  });

  it('GET /health', async () => {
    app = await createApp({});
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body.providers).toEqual({ gemini: true, groq: true });
  });

  it('POST /chat responde', async () => {
    app = await createApp({});
    const res = await request(app.getHttpServer()).post('/chat').send({ message: 'Hola' }).expect(200);
    expect(res.body).toMatchObject({ reply: '¡Hola! Soy Mitlan.', provider: 'gemini', places: [] });
    expect(res.body.suggestions.length).toBeGreaterThan(0);
  });

  it('POST /chat valida el cuerpo', async () => {
    app = await createApp({});
    await request(app.getHttpServer()).post('/chat').send({ message: '' }).expect(400);
    await request(app.getHttpServer()).post('/chat').send({ message: 'hola', hackeo: true }).expect(400);
    await request(app.getHttpServer())
      .post('/chat')
      .send({ message: 'hola', location: { lat: 200, lng: 0 } })
      .expect(400);
  });

  it('POST /chat exige x-api-key cuando CHAT_API_KEY está configurada', async () => {
    app = await createApp({ CHAT_API_KEY: 'secreto' });
    await request(app.getHttpServer()).post('/chat').send({ message: 'Hola' }).expect(401);
    await request(app.getHttpServer()).post('/chat').set('x-api-key', 'secreto').send({ message: 'Hola' }).expect(200);
  });
});