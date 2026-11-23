import { CatalogStatus } from '../places/places.service';

/**
 * Contrato público de /chat (v2, aditivo sobre v1).
 *
 * `reply` es Markdown limitado (CommonMark): párrafos separados por línea en blanco,
 * listas `- ` o `1. ` y negritas `**…**`. No incluye encabezados, enlaces, imágenes,
 * tablas, código ni HTML. Los textos del catálogo se sanean antes de insertarse.
 */
export const REPLY_FORMAT = 'markdown' as const;

/** conversation: charla general sin tarjetas. recommendation/itinerary: hay tarjetas validadas; notice: aviso local sin modelo; empty: sin selección verificable. */
export type ReplyKind = 'conversation' | 'recommendation' | 'itinerary' | 'notice' | 'empty';

export type ReplyCode = CatalogStatus | 'selection-fallback' | 'selection-empty' | 'conversation-guarded';

/**
 * Invariantes del contrato (probadas en test/kind-code-coherence.spec.ts):
 * - places no vacío ⇔ kind recommendation | itinerary, y code found | selection-fallback.
 * - kind empty ⇒ code selection-empty (hubo candidatos y no se seleccionó ninguno).
 * - kind notice ⇒ code es un estado del catálogo distinto de found; sin tarjetas.
 * - kind conversation ⇒ code conversation | conversation-guarded; sin tarjetas.
 */
export function resolveRecommendationCode(selectedCount: number, fallback: boolean): ReplyCode {
  if (selectedCount === 0) return 'selection-empty';
  return fallback ? 'selection-fallback' : 'found';
}

/** Caracteres con significado en Markdown o HTML que nunca deben llegar desde el catálogo. */
const MARKDOWN_CONTROL = /[\\`*\[\]<>#]/g;
/** Separadores que, al quitarse, deben dejar espacio entre palabras. */
const MARKDOWN_SEPARATORS = /[_|~]/g;

/** Texto del catálogo apto para Markdown: sin controles, saltos ni marcadores de bloque al inicio. */
export function markdownSafe(value: string): string {
  return value
    .replace(/[\r\n\t]+/g, ' ')
    .replace(MARKDOWN_SEPARATORS, ' ')
    .replace(MARKDOWN_CONTROL, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    // Evita que un nombre como "1. Algo" o "- Algo" se convierta en lista o regla horizontal.
    .replace(/^(?:[-+=]+|\d+[.)])\s*/, '')
    .trim();
}

/** Escapado legado (v1) que algunos historiales de Flutter todavía reenvían. */
export function legacyEscaped(value: string): string {
  return value.replace(/[\r\n\t]/g, ' ').replace(/[<>*_`\[\]\\]/g, char => '\\' + char);
}
