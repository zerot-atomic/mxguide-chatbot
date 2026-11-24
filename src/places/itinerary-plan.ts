import { normalize } from './state-resolver';
import { MAX_ITINERARY_DAYS } from './itinerary';

/**
 * Planificación de itinerarios por días (etapa 3). Funciones puras y deterministas:
 * la misma entrada produce siempre la misma salida. El modelo de IA solo elige y ordena IDs;
 * la distribución por días ocurre aquí, en el backend.
 *
 * Sin coordenadas, horarios, traslados ni costos: el orden NO es una ruta optimizada.
 */
export const STOPS_PER_DAY = 3;
export const MAX_ITINERARY_STOPS = STOPS_PER_DAY * MAX_ITINERARY_DAYS; // 21
/** Candidatos locales para itinerarios con duración conocida (en lugar de 15). */
export const ITINERARY_CANDIDATE_LIMIT = 30;

/** Lo mínimo que necesita el planificador de cada destino ya validado. */
export interface PlannableStop {
  id: string;
  /** Categorías confirmadas separadas por « · » (puede ser vacío). */
  category: string;
}

export interface PlannedDay {
  day: number;
  placeIds: string[];
}

export interface ItineraryPlan<T extends PlannableStop = PlannableStop> {
  /** Destinos en el orden final: Día 1, luego Día 2… (es el orden de `places`). */
  ordered: T[];
  /** Solo días con destinos, numerados desde 1, máximo STOPS_PER_DAY por día. */
  days: PlannedDay[];
  /** Días pedidos (1–7). */
  requestedDays: number;
  /** Días pedidos que quedaron sin destinos (no se inventan destinos para cubrirlos). */
  freeDays: number;
}

/** Cantidad objetivo de destinos: el menor entre días × 3, 21 y candidatos disponibles. */
export function itineraryTarget(requestedDays: number, available: number): number {
  const days = clampDays(requestedDays);
  return Math.max(0, Math.min(days * STOPS_PER_DAY, MAX_ITINERARY_STOPS, Math.floor(available)));
}

/** Primera categoría confirmada; los registros sin categoría forman su propio grupo. */
function primaryCategory(stop: PlannableStop): string {
  return normalize((stop.category ?? '').split('·')[0] ?? '');
}

/**
 * Alterna categorías cuando hay variedad: agrupa por primera categoría (en orden de primera aparición)
 * y toma uno de cada grupo por turno. Conserva el orden relativo dentro de cada grupo y nunca descarta
 * destinos; si todos son de la misma categoría, el orden de entrada se mantiene intacto.
 */
export function interleaveByCategory<T extends PlannableStop>(stops: T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const stop of stops) {
    const key = primaryCategory(stop);
    const group = groups.get(key);
    if (group) group.push(stop); else groups.set(key, [stop]);
  }
  const queues = [...groups.values()];
  const result: T[] = [];
  for (let round = 0; result.length < stops.length; round++) {
    for (const queue of queues) if (round < queue.length) result.push(queue[round]);
  }
  return result;
}

/**
 * Distribuye destinos validados entre días de forma equilibrada.
 * - Elimina duplicados por ID (conserva la primera aparición) y descarta entradas sin ID.
 * - Limita a días × 3 y a 21 destinos.
 * - Usa solo los días necesarios: con menos destinos que días, una parada por día y el resto queda libre.
 * - Reparto: ⌊n/d⌋ por día y un destino extra en los primeros n mod d días (p. ej. 10 en 4 días → 3,3,2,2).
 */
export function planItineraryDays<T extends PlannableStop>(stops: T[], requestedDays: number): ItineraryPlan<T> {
  const days = clampDays(requestedDays);
  const seen = new Set<string>();
  const unique = stops.filter(stop => {
    if (!stop || typeof stop.id !== 'string' || !stop.id || seen.has(stop.id)) return false;
    seen.add(stop.id);
    return true;
  });
  const selected = interleaveByCategory(unique.slice(0, itineraryTarget(days, unique.length)));
  const usedDays = Math.min(days, selected.length);
  const plan: PlannedDay[] = [];
  let cursor = 0;
  for (let day = 1; day <= usedDays; day++) {
    const size = Math.floor(selected.length / usedDays) + (day <= selected.length % usedDays ? 1 : 0);
    plan.push({ day, placeIds: selected.slice(cursor, cursor + size).map(stop => stop.id) });
    cursor += size;
  }
  return { ordered: selected, days: plan, requestedDays: days, freeDays: days - usedDays };
}

function clampDays(requestedDays: number): number {
  if (!Number.isFinite(requestedDays)) return 1;
  return Math.min(MAX_ITINERARY_DAYS, Math.max(1, Math.floor(requestedDays)));
}
