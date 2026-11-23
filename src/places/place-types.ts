import { normalize } from './state-resolver';

/**
 * Tipos de lugar que el usuario puede pedir pero que NO existen como categoría del catálogo de MXGuide
 * (las categorías confirmadas son Histórico, Arqueológico, Cultural, Natural, Religioso, Hospedaje y Gastronomía).
 *
 * No se asume que un tipo pertenezca a otra categoría (una playa no se trata como «Natural»): solo cuenta como
 * evidencia que el propio registro del catálogo mencione el tipo en su nombre o en su descripción.
 */
export interface RequestedPlaceType {
  key: 'beach' | 'cenote' | 'tour' | 'magic-town' | 'spa' | 'nightlife';
  /** Etiqueta en plural para los textos al usuario. */
  label: string;
  pattern: RegExp;
}

const TYPES: RequestedPlaceType[] = [
  { key: 'beach', label: 'playas', pattern: /\bplayas?\b/ },
  { key: 'cenote', label: 'cenotes', pattern: /\bcenotes?\b/ },
  { key: 'tour', label: 'tours', pattern: /\b(tours?|excursion|excursiones)\b/ },
  { key: 'magic-town', label: 'pueblos mágicos', pattern: /\bpueblos? magicos?\b/ },
  { key: 'spa', label: 'balnearios', pattern: /\b(balnearios?|aguas termales|parques? acuaticos?)\b/ },
  { key: 'nightlife', label: 'vida nocturna', pattern: /\b(antros?|vida nocturna)\b/ },
];

/** Tipo pedido en el mensaje; `multiple` si mezcla varios (se pide aclarar en vez de adivinar). */
export function detectRequestedType(message: string): RequestedPlaceType | 'multiple' | undefined {
  const text = normalize(message);
  const found = TYPES.filter(type => type.pattern.test(text));
  if (found.length > 1) return 'multiple';
  return found[0];
}

/** Evidencia del catálogo: el nombre o la descripción del registro mencionan el tipo pedido. */
export function hasTypeEvidence(raw: unknown, type: RequestedPlaceType): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const record = raw as Record<string, unknown>;
  const text = [record.name, record.shortDescription].filter((v): v is string => typeof v === 'string').join(' ');
  return type.pattern.test(normalize(text));
}
