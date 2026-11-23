import { randomUUID } from 'node:crypto';

/**
 * Registro técnico de una petición de chat (una línea JSON en la consola de Nest / Render).
 *
 * Solo metadatos: NUNCA incluye el mensaje, el historial, nombres, ubicación, coordenadas, credenciales,
 * respuestas del modelo ni textos del catálogo. Los IDs de estado son identificadores públicos del catálogo.
 */
export interface ChatDiagnostic {
  requestId: string;
  /** conversation: charla sin catálogo · catalog: selección con IA · notice: aviso local sin IA. */
  route: 'conversation' | 'catalog' | 'notice';
  catalogStatus: string;
  intent?: string;
  mode?: string;
  stateId?: string;
  requestedType?: string;
  /** Modo itinerario y días pedidos (1–7), si aplica. */
  itinerary?: boolean;
  itineraryDays?: number;
  /** Días con destinos en el plan (≤ itineraryDays); ausente si no hubo distribución. */
  plannedDays?: number;
  /** Candidatos del catálogo enviados al selector y tarjetas finales. */
  candidates: number;
  selected: number;
  /** Proveedor que respondió; null si no se invocó IA. */
  provider: string | null;
  kind?: string;
  code?: string;
  outcome: 'ok' | 'error';
  /** Clase de error sin detalles (p. ej. ServiceUnavailableException). */
  error?: string;
  historyTurns: number;
  hasLocation: boolean;
  durationMs: number;
}

export const newRequestId = (): string => randomUUID();

/** Campos permitidos, en orden estable: cualquier otra propiedad se descarta antes de registrar. */
const ALLOWED: (keyof ChatDiagnostic)[] = ['requestId', 'route', 'catalogStatus', 'intent', 'mode', 'stateId', 'requestedType', 'itinerary', 'itineraryDays', 'plannedDays', 'candidates', 'selected', 'provider', 'kind', 'code', 'outcome', 'error', 'historyTurns', 'hasLocation', 'durationMs'];

export function serializeDiagnostic(diagnostic: ChatDiagnostic): string {
  const record: Record<string, unknown> = {};
  for (const key of ALLOWED) if (diagnostic[key] !== undefined) record[key] = diagnostic[key];
  return 'chat ' + JSON.stringify(record);
}
