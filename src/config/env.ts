/**
 * Configuración del servicio, leída de variables de entorno.
 * Se valida al arrancar: si algo está mal, el servidor no levanta
 * (mejor tronar al desplegar que fallar a medias con usuarios reales).
 */
export type ProviderName = 'gemini' | 'groq';
export type ChatStrategy = 'fallback' | 'race';

export interface AppConfig {
  port: number;
  gemini: { apiKey?: string; model: string };
  groq: { apiKey?: string; model: string };
  primaryProvider: ProviderName;
  strategy: ChatStrategy;
  providerTimeoutMs: number;
  maxOutputTokens: number;
  mxguideApiUrl?: string;
  placesTimeoutMs: number;
  chatApiKey?: string;
  corsOrigins: string[];
  rateLimitPerMinute: number;
}

const blankToUndefined = (value?: string) => (value && value.trim() ? value.trim() : undefined);

function toInt(name: string, raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} debe ser un entero entre ${min} y ${max} (recibí "${raw}")`);
  }
  return value;
}

function oneOf<T extends string>(name: string, raw: string | undefined, options: readonly T[], fallback: T): T {
  const value = blankToUndefined(raw)?.toLowerCase();
  if (!value) return fallback;
  if (!options.includes(value as T)) {
    throw new Error(`${name} debe ser uno de: ${options.join(', ')} (recibí "${raw}")`);
  }
  return value as T;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const geminiKey = blankToUndefined(env.GEMINI_API_KEY);
  const groqKey = blankToUndefined(env.GROQ_API_KEY);
  if (!geminiKey && !groqKey) {
    throw new Error('Configura al menos una llave de IA: GEMINI_API_KEY o GROQ_API_KEY.');
  }

  const apiUrl = blankToUndefined(env.MXGUIDE_API_URL)?.replace(/\/+$/, '');
  if (apiUrl && !/^https?:\/\//.test(apiUrl)) {
    throw new Error('MXGUIDE_API_URL debe empezar con http:// o https://');
  }

  return {
    port: toInt('PORT', env.PORT, 3000, 1, 65535),
    gemini: { apiKey: geminiKey, model: blankToUndefined(env.GEMINI_MODEL) ?? 'gemini-3.6-flash' },
    groq: { apiKey: groqKey, model: blankToUndefined(env.GROQ_MODEL) ?? 'openai/gpt-oss-120b' },
    primaryProvider: oneOf('PRIMARY_PROVIDER', env.PRIMARY_PROVIDER, ['gemini', 'groq'] as const, 'gemini'),
    strategy: oneOf('CHAT_STRATEGY', env.CHAT_STRATEGY, ['fallback', 'race'] as const, 'fallback'),
    providerTimeoutMs: toInt('PROVIDER_TIMEOUT_MS', env.PROVIDER_TIMEOUT_MS, 25000, 1000, 120000),
    maxOutputTokens: toInt('MAX_OUTPUT_TOKENS', env.MAX_OUTPUT_TOKENS, 4096, 64, 32768),
    mxguideApiUrl: apiUrl,
    placesTimeoutMs: toInt('PLACES_TIMEOUT_MS', env.PLACES_TIMEOUT_MS, 15000, 1000, 120000),
    chatApiKey: blankToUndefined(env.CHAT_API_KEY),
    corsOrigins: (env.CORS_ORIGINS ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    rateLimitPerMinute: toInt('RATE_LIMIT_PER_MINUTE', env.RATE_LIMIT_PER_MINUTE, 20, 1, 10000),
  };
}

/** Token de inyección para la configuración. */
export const APP_CONFIG = Symbol('APP_CONFIG');