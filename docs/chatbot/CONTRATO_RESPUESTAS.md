# Contrato de respuestas v2 — Mictlán

Cambio **aditivo**: los campos de v1 (`reply`, `provider`, `places`, `suggestions`, `statusCode`, `message`) se conservan. Un cliente v1 sigue funcionando; solo verá `reply` con `**negritas**` si no renderiza Markdown.

## 200 OK — `POST /chat`

| Campo | Tipo | Uso en Flutter |
|---|---|---|
| `reply` | String Markdown limitado | Renderizar con un visor Markdown (p. ej. `flutter_markdown` / `MarkdownBody`), **no** con `Text`. |
| `format` | `"markdown"` | Siempre `markdown` en v2. Si falta (servidor v1), mostrar `reply` como texto plano. |
| `kind` | `conversation` · `recommendation` · `itinerary` · `notice` · `empty` (`empty`: hubo candidatos del catálogo pero ninguno corresponde a lo pedido; siempre con `code: selection-empty`) | `conversation`: charla general redactada por Mictlán, siempre sin tarjetas. `notice`: aviso local (aclaración, ubicación faltante, catálogo caído) sin tarjetas. `empty`: no hubo selección verificable. |
| `code` | String estable | Motivo técnico: estado del catálogo (`found`, `empty`, `missing-location`, `ambiguous`, `unrecognized`, `intent-ambiguous`, `followup-ambiguous`, `itinerary-missing-state`, `itinerary-food-unverified`, `categories-unavailable`, `http`, `timeout`, `connection`, `malformed`, `unconfigured`) `itinerary-days-out-of-range` (itinerario de más de 7 días: aviso que pide elegir de 1 a 7, sin lista ni IA), `exhausted` (un «¿qué más?» cuando ya se mostraron todos los destinos que coinciden en ese estado), `type-unverified` (se pidió un tipo de lugar que el catálogo no clasifica, como playas o cenotes, y ningún registro lo menciona), `conversation`, `conversation-guarded` (la respuesta libre se sustituyó por un texto seguro), `selection-fallback` o `selection-empty`. Útil para lógica de UI (p. ej. `missing-location` → ofrecer permiso de ubicación). **No mostrar al usuario.** Valores nuevos pueden aparecer: tratar desconocidos como genéricos. |
| `provider` | `gemini` · `groq` | Solo depuración. |
| `places` | Array (0–5; hasta 21 en itinerarios con duración) | **Únicos destinos validados.** Tarjetas = solo este arreglo, en este orden. Nunca derivar tarjetas del texto de `reply`. |
| `suggestions` | Array de strings | Consultas sugeridas. |
| `itinerary` | Objeto **opcional** | Solo en `kind: itinerary` con duración reconocida (1–7 días). En cualquier otra respuesta la llave **no existe** (no es `null`). Ver «Itinerario por días». |

### Markdown permitido en `reply`
- Párrafos separados por línea en blanco (`\n\n`).
- Listas `- ` y numeradas `1. ` (itinerarios). Cada número corresponde a `places[i]`.
- Negritas `**…**` solo para nombres de lugares.
- **No** se emiten encabezados, enlaces, imágenes, tablas, código ni HTML.
- Los textos del catálogo se sanean en NestJS: se quitan `\ ` `` ` `` `* [ ] < > #`, y `_ | ~` se vuelven espacio. Ya **no** se usan diagonales de escape (`\*`).

Recomendación al renderizar: desactivar enlaces/imágenes en el visor y deshabilitar HTML.

### Historial
Reenviar `reply` **tal cual** como turno `assistant`. El seguimiento («de esos») lee el formato v2 y también historiales v1 con escapes.

## Errores

```json
{ "statusCode": 503, "message": "El asistente no está disponible en este momento.",
  "error": { "code": "unavailable", "message": "El asistente no está disponible en este momento.", "retryable": true } }
```

| HTTP | `error.code` | `retryable` |
|---|---|---|
| 400 | `invalid_request` | false |
| 401 | `unauthorized` | false |
| 404 | `not_found` | false |
| 413 | `payload_too_large` | false |
| 429 | `rate_limited` | true |
| 503 | `unavailable` | true |
| 5xx otros | `internal` | true |

Decidir con `error.code` / `retryable`, no con `message`. Los errores **no** se agregan al historial como turnos `assistant`. Nunca incluyen detalles internos.

## Motor híbrido (fase 3)

| Mensaje | Ruta | Qué recibe el modelo | Tarjetas |
|---|---|---|---|
| Sin señal turística («Hola», «¿Qué clima hace?», «Gracias») | `conversation` | Prompt de Mictlán + últimos 12 turnos (secretos, correos y enlaces redactados). Sin catálogo, nombre ni ubicación. | Nunca |
| Estado, intención (museos, hoteles…), cercanía, «recomiéndame lugares», «de esos», o seguimiento «¿y…?» que hereda un estado del historial | catálogo | Solo `query`, `intent` y candidatos filtrados; sin historial | Solo IDs validados |

- En la ruta de catálogo el modelo puede devolver `message`: una introducción breve de tono. Se descarta si nombra lugares, contiene cifras, enlaces, Markdown o datos operativos (precios, horarios, servicios). Los itinerarios conservan su plantilla.
- En la ruta de conversación se prohíbe recomendar destinos concretos; si la respuesta incluye precios, horas o teléfonos, se sustituye completa (`conversation-guarded`).
- Con el catálogo caído o sin configurar, la conversación general sigue funcionando; las consultas turísticas reciben el aviso local.

## Coherencia kind / code / places

| `places` | `kind` | `code` |
|---|---|---|
| 1–5 | `recommendation` · `itinerary` | `found` (selección del modelo) · `selection-fallback` (selección local por salida inválida) |
| 0 | `empty` | `selection-empty` |
| 0 | `notice` | estado del catálogo (`empty`, `exhausted`, `type-unverified`, `itinerary-days-out-of-range`, `missing-location`, …); nunca `found` |
| 0 | `conversation` | `conversation` · `conversation-guarded` |

`code: found` implica siempre al menos una tarjeta.

## Tipos de lugar sin categoría

Las categorías confirmadas del catálogo son Histórico, Arqueológico, Cultural, Natural, Religioso, Hospedaje y Gastronomía. Para **playas, cenotes, tours, pueblos mágicos, balnearios y vida nocturna** no se asume ninguna categoría: solo se proponen registros cuyo nombre o descripción mencionan el tipo pedido (y no son solo hospedaje o gastronomía, salvo que se pidan hoteles o restaurantes). Sin evidencia se responde `notice` + `type-unverified`, sin invocar IA. Pedir varios tipos a la vez devuelve `intent-ambiguous`.

## Diagnóstico

Con `LOG_LEVEL=log` (por defecto fuera de pruebas) cada petición registra una línea:

```
LOG [ChatService] chat {"requestId":"…","route":"notice","catalogStatus":"type-unverified","intent":"attractions","mode":"state","stateId":"…","requestedType":"beach","candidates":0,"selected":0,"provider":null,"kind":"notice","code":"type-unverified","outcome":"ok","historyTurns":0,"hasLocation":false,"durationMs":412}
```

Solo metadatos; nunca mensaje, historial, nombre, ubicación, credenciales, respuestas del modelo ni textos del catálogo. Los fallos de proveedor (`WARN … Falló groq (HTTP 429)`) y del catálogo (`WARN … Catálogo /places/nearby: HTTP 503`) registran motivos técnicos fijos, sin cuerpos ni parámetros de consulta.

## Itinerario por días (`itinerary`, etapa 4)

```json
"itinerary": {
  "requestedDays": 3,
  "days": [
    { "day": 1, "placeIds": ["uuid-1", "uuid-2", "uuid-3"] },
    { "day": 2, "placeIds": ["uuid-4", "uuid-5", "uuid-6"] },
    { "day": 3, "placeIds": ["uuid-7", "uuid-8"] }
  ]
}
```

Reglas garantizadas por el backend (probadas en `test/itinerary-plan.spec.ts`):

1. `requestedDays` = duración reconocida (1–7).
2. `days` solo contiene días con destinos; `day` es consecutivo desde 1; cada día tiene de 1 a 3 IDs.
3. Ningún ID se repite; todos están en `places`.
4. `days.flatMap(d => d.placeIds)` es **exactamente** `places.map(p => p.id)`, en el mismo orden. `places` sigue siendo la única fuente de las tarjetas; `itinerary` solo agrupa IDs.
5. Con menos destinos que días, `requestedDays` se conserva y `days.length < requestedDays`; el `reply` explica los días libres. No hay campo `partial`.
6. En `reply`, cada día aparece como `**Día N**` y la numeración es global: el destino N es `places[N-1]`.

Compatibilidad: recomendaciones, conversación, avisos, `empty`, itinerarios sin duración y errores HTTP conservan exactamente los siete campos (sin la llave). Más de 7 días no produce itinerario: responde `kind: notice`, `code: itinerary-days-out-of-range` y el siguiente mensaje con una duración válida continúa en el mismo estado. Seguimientos y cambios de duración: ver [ITINERARIOS_SENCILLOS.md](ITINERARIOS_SENCILLOS.md). Un cliente que ignore `itinerary` sigue funcionando: `reply` y `places` bastan.

