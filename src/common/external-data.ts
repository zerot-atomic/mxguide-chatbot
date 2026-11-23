/** Bounded JSON reader for real fetch streams; no remote body is included in errors. */
export async function readBoundedJson(response: Response, maxBytes: number): Promise<unknown> {
  const length = Number(response.headers?.get('content-length'));
  if (Number.isFinite(length) && length > maxBytes) { await response.body?.cancel(); throw new Error('response-too-large'); }
  if (!response.body) {
    // Empty bodies and lightweight test doubles also pass through the byte limit.
    const text = typeof response.text === 'function' ? await response.text() : JSON.stringify(await response.json());
    if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new Error('response-too-large');
    return JSON.parse(text);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new Error('response-too-large'); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { reader.releaseLock(); }
}

/** Links from catalogue text are never needed in the public card contract. */
export const hasExternalReference = (text: string): boolean => /(?:[a-z][a-z0-9+.-]*:\/\/|www\.|\b[a-z0-9-]+\.(?:[a-z]{2,63})\b|mailto:|javascript:|data:)/i.test(text);
export function redactSelectionText(text: string, secrets: (string | undefined)[]): string {
  let result = text;
  for (const secret of secrets) if (secret) result = result.split(secret).join('[dato omitido]');
  return redactPersonalData(result.replace(/\bBearer\s+\S+/gi, '[autorización omitida]')
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[correo omitido]')
    .replace(/(?:https?:\/\/|www\.)\S+/gi, '[enlace omitido]')
    .replace(/\b(?:api[_ -]?key|token|authorization)\s*[:=]\s*\S+/gi, '[credencial omitida]'));
}

/**
 * Datos personales que nunca necesita el modelo. Conservador: ante la duda se omite.
 * El orden importa (tarjeta antes que teléfono, CURP antes que RFC).
 */
export function redactPersonalData(text: string): string {
  return text
    // CURP (18) y RFC de persona física (13) o moral (12).
    .replace(/\b[A-Z][AEIOUX][A-Z]{2}\d{6}[HM][A-Z]{5}[A-Z0-9]\d\b/gi, '[CURP omitida]')
    .replace(/\b[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}\b/gi, '[RFC omitido]')
    // Tarjetas: 13–19 dígitos con espacios o guiones opcionales.
    .replace(/\b(?:\d[ -]?){12,18}\d\b/g, '[tarjeta omitida]')
    // Teléfonos: 10 dígitos (opcional +52 / 52 / 1), separados o no.
    .replace(/(?:\+?52[\s.-]?)?(?:1[\s.-]?)?\(?\d{2,3}\)?[\s.-]?\d{3,4}[\s.-]?\d{4}\b/g, '[teléfono omitido]')
    // Coordenadas escritas a mano: "19.0414, -98.2063".
    .replace(/-?\b\d{1,3}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}\b/g, '[ubicación omitida]')
    // Direcciones: calle/avenida/colonia/código postal con su contenido hasta coma o fin de frase.
    .replace(/\b(?:calle|c\.|av\.?|avenida|blvd\.?|boulevard|calzada|privada|col\.|colonia|fracc\.?|fraccionamiento)\s+[^,.;\n]*\d[^,.;\n]*/gi, '[dirección omitida]')
    .replace(/\b(?:[Cc]ol\.|[Cc]olonia)\s+[A-ZÁÉÍÓÚÑ][^,.;\n]*/g, '[dirección omitida]')
    .replace(/\b(?:c\.\s?p\.?|cp|código postal|codigo postal)\s*:?\s*\d{5}\b/gi, '[código postal omitido]')
    // Nombre propio que el usuario declara.
    .replace(/\b([Mm]e llamo|[Mm]i nombre es|[Mm]i nombre completo es|[Ss]oy (?:el|la) (?:señora?|sr\.?|sra\.?))\s+[A-ZÁÉÍÓÚÑ][\p{L}'’-]*(?:\s+[A-ZÁÉÍÓÚÑ][\p{L}'’-]*){0,3}/gu, '$1 [nombre omitido]');
}

/** Quita el saludo de personalización («¡Hola, Ana! ») que la app reenvía dentro de los turnos assistant. */
export function stripPersonalGreeting(text: string): string {
  return text.replace(/^¡Hola, [\p{L}\p{M}'’ -]{1,60}! /u, '');
}
