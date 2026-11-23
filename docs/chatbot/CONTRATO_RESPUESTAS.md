# Contrato de respuestas v2 — Mictlán

Cambio **aditivo**: los campos de v1 (`reply`, `provider`, `places`, `suggestions`, `statusCode`, `message`) se conservan. Un cliente v1 sigue funcionando; solo verá `reply` con `**negritas**` si no renderiza Markdown.

## 200 OK — `POST /chat`

| Campo | Tipo | Uso en Flutter |
|---|---|---|
| `reply` | String Markdown limitado | Renderizar con un visor Markdown (p. ej. `flutter_markdown` / `MarkdownBody`), **no** con `Text`. |
| `format` | `"markdown"` | Siempre `markdown` en v2. Si falta (servidor v1), mostrar `reply` como texto plano. |
| `kind` | `conversation` · `recommendation` · `itinerary` · `notice` · `empty` (`empty`: hubo candidatos del catálogo pero ninguno corresponde a lo pedido; siempre con `code: selection-empty`) | `conversation`: charla general redactada por Mictlán, siempre sin tarjetas. `notice`: aviso local (aclaración, ubicación faltante, catálogo caído) sin tarjetas. `empty`: no hubo selección verificable. |
| `code` | String estable | Motivo técnico: estado del catálogo (`found`, `empty`, `missing-location`, `ambiguous`, `unrecognized`, `intent-ambiguous`, `followup-ambiguous`, `itinerary-missing-state`, `itinerary-food-unverified`, `categories-unavailable`, `http`, `timeout`, `connection`, `malformed`, `unconfigured`) `type-unverified` (se pidió un tipo de lugar que el catálogo no clasifica, como playas o cenotes, y ningún registro lo menciona), `conversation`, `conversation-guarded` (la respuesta libre se sustituyó por un texto seguro), `selection-fallback` o `selection-empty`. Útil para lógica de UI (p. ej. `missing-location` → ofrecer permiso de ubicación). **No mostrar al usuario.** Valores nuevos pueden aparecer: tratar desconocidos como genéricos. |
| `provider` | `gemini` · `groq` | Solo depuración. |
| `places` | Array (0–5) | **Únicos destinos validados.** Tarjetas = solo este arreglo, en este orden. Nunca derivar tarjetas del texto de `reply`. |
| `suggestions` | Array de strings | Consultas sugeridas. |

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
| 0 | `notice` | estado del catálogo (`empty`, `type-unverified`, `missing-location`, …); nunca `found` |
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
