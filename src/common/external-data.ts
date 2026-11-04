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
  return result.replace(/\bBearer\s+\S+/gi, '[autorización omitida]')
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[correo omitido]')
    .replace(/(?:https?:\/\/|www\.)\S+/gi, '[enlace omitido]')
    .replace(/\b(?:api[_ -]?key|token|authorization)\s*[:=]\s*\S+/gi, '[credencial omitida]');
}
