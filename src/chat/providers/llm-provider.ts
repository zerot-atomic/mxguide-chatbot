import { ProviderName } from '../../config/env';

export type ChatRole = 'user' | 'assistant';

export interface ChatTurn {
  role: ChatRole;
  content: string;
}

/** Lo que cada proveedor recibe: instrucciones, historial y el mensaje nuevo. */
export interface LlmRequest {
  system: string;
  history: ChatTurn[];
  message: string;
}

/** Un "agente" de IA: Gemini, Grok o cualquiera que se agregue después. */
export interface LlmProvider {
  readonly name: ProviderName;
  isConfigured(): boolean;
  generate(request: LlmRequest): Promise<string>;
}

/** Error de un proveedor, con el código HTTP si lo hubo. */
export class ProviderError extends Error {
  constructor(
    readonly provider: ProviderName,
    message: string,
    readonly status?: number,
  ) {
    super(`[${provider}] ${message}`);
  }
}

/** Token de inyección para la lista de proveedores. */
export const LLM_PROVIDERS = Symbol('LLM_PROVIDERS');

/** fetch con tiempo límite; convierte el timeout en un ProviderError legible. */
export async function fetchJson(
  provider: ProviderName,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    const reason = error instanceof Error && error.name === 'TimeoutError' ? 'tiempo agotado' : 'sin conexión';
    throw new ProviderError(provider, reason);
  }

  const text = await response.text();
  if (!response.ok) {
    // No se reenvía el cuerpo al usuario: puede traer detalles internos.
    throw new ProviderError(provider, `HTTP ${response.status}: ${text.slice(0, 300)}`, response.status);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ProviderError(provider, 'respuesta que no es JSON');
  }
}
