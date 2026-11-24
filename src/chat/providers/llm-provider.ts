import { readBoundedJson } from '../../common/external-data';
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

/** Un "agente" de IA: Gemini, Groq o cualquiera que se agregue después. */
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
    response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    const reason = (error as {name?:string})?.name === 'TimeoutError' ? 'tiempo agotado' : 'sin conexión';
    throw new ProviderError(provider, reason);
  }

  if (!response.ok) {
    await response.body?.cancel();
    throw new ProviderError(provider, 'HTTP ' + response.status, response.status);
  }
  try { return await readBoundedJson(response, 256 * 1024); }
  catch (error) { throw new ProviderError(provider, (error as {name?:string})?.name === 'TimeoutError' ? 'tiempo agotado' : 'respuesta inválida'); }
}
