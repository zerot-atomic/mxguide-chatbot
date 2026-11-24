# MXGuide Chatbot · Mictlán

**Mictlán** es el asistente de viaje de **MXGuide** («México en tus manos»). Este repositorio es su backend: una API NestJS independiente que recibe los mensajes de la app Flutter, consulta el catálogo del backend principal de MXGuide y usa modelos de IA (**Google Gemini** y **Groq**) para conversar y para **seleccionar** destinos. La validación final, la presentación y el contrato de respuesta los controla este backend: el modelo nunca aporta destinos, IDs ni datos operativos que el catálogo no tenga.

```
App Flutter ──POST /chat──▶ mxguide-chatbot (NestJS)
                               ├─▶ Gemini / Groq   (fallback o race)
                               └─GET /states, /places?stateId=…, /places/featured, /places/nearby──▶ backend principal MXGuide
```

Las llaves de IA viven **solo en este servidor**, nunca en la app.

## Responsabilidades

- Decidir si un mensaje es **conversación general** o **consulta turística** (sin IA).
- Consultar el catálogo con **filtros de estado, intención y tipo** y limitar los candidatos.
- Pedir al modelo una **selección de IDs** y validarla contra una lista blanca; si es inválida, aplicar un respaldo determinista.
- Mantener el **contexto** de seguimientos a partir del historial que reenvía el cliente (el servidor no guarda sesiones).
- Construir **itinerarios de 1 a 7 días** distribuidos por día en el propio backend.
- Responder con un **contrato estable** (`reply` en Markdown limitado, `kind`, `code`, `places` y, solo en itinerarios con duración, `itinerary`).

## Tecnologías

Verificadas en `package.json` y `src/`:

- **NestJS 11** + **TypeScript**, Express (`@nestjs/platform-express`). Node `>=20` (`engines`); `.nvmrc` y Render usan **Node 22**.
- `fetch` nativo hacia las APIs REST de **Gemini** (`generateContent`) y **Groq** (compatible con OpenAI, `/openai/v1/chat/completions`); sin SDKs.
- `class-validator` / `class-transformer` (validación estricta del cuerpo), `@nestjs/throttler` (límite por IP), `helmet`.
- Pruebas con **Jest** + `ts-jest` y `supertest`; proveedores y catálogo simulados (no consumen IA ni red).

## Funcionalidades

### Motor conversacional híbrido
- **Conversación general** («Hola», «¿qué ropa llevo?»): el modelo responde con tono natural usando los últimos 12 turnos del historial, **redactado** (llaves, correos, enlaces, teléfonos, CURP/RFC, tarjetas, direcciones, coordenadas y nombre declarado). No recibe catálogo, ubicación ni nombre de usuario; una guarda reemplaza respuestas con precios, horarios, teléfonos o recomendaciones de lugares concretos no verificados.
- **Consulta turística**: el modelo solo recibe la pregunta redactada, la intención y los candidatos del catálogo, y devuelve `{"placeIds":[…],"message":"…"}`. Los IDs se validan; la introducción (`message`) solo se usa si no nombra lugares ajenos, cifras, enlaces ni datos operativos.
- El enrutamiento es local: si el mensaje no tiene señal turística ni posible estado, no se consulta el catálogo.

### Recomendaciones y filtros
- Resolución del **estado** contra `/states` del catálogo (nombres e IDs reales); aclaración ante varios estados o exclusiones.
- **Intenciones**: atractivos, histórico, arqueológico, cultural, natural, religioso, hospedaje, gastronomía (restaurantes/platillos).
- **Tipos sin categoría** (playas, cenotes, tours, pueblos mágicos, balnearios, vida nocturna): solo se proponen registros que los mencionan en nombre o descripción; si no hay evidencia, aviso `type-unverified`.
- **Cercanía** con `location` («cerca de mí»).
- Tarjetas (`places`) solo de candidatos validados; nunca se derivan del texto.

### Contexto y seguimientos
El cliente reenvía `history`. Con él se conservan estado, intención y duración en seguimientos como «¿Y en Oaxaca?», «¿Y uno cultural?», «de esos», «¿qué más?» (sin repetir lo mostrado), «mejor que sean 2 días» o «agrega un museo», también con muletillas iniciales («Perdón, mejor 5 días», «No, mejor en Oaxaca»). Una charla intermedia no relacionada corta la cadena.

### Itinerarios
- Detección de frases como «itinerario», «recorrido», «planea mi viaje a…», «planéame 2 días en…», «ruta por…», «organízame un fin de semana en…».
- Duración explícita de **1 a 7 días** («fin de semana» = 2, «una semana» = 7). Sin duración no se supone ninguna; **más de 7 días** responde un aviso que pide elegir de 1 a 7.
- Con duración: hasta **3 destinos por día** y **21 por itinerario**, a partir de hasta 30 candidatos del estado. La **distribución por días la hace el backend** de forma determinista y equilibrada (alterna categorías cuando hay variedad). Con menos destinos que días, no se inventan destinos ni días vacíos y se informan los días libres.
- Itinerarios de comida bloqueados (el catálogo no distingue restaurantes de platillos). No hay horarios, traslados, distancias, costos ni rutas optimizadas.

Detalle: [docs/chatbot/ITINERARIOS_SENCILLOS.md](docs/chatbot/ITINERARIOS_SENCILLOS.md).

## Endpoints

### `POST /chat`

```json
{
  "message": "Planéame 3 días en Puebla",
  "history": [
    { "role": "user", "content": "Hola" },
    { "role": "assistant", "content": "¡Hola! Soy Mictlán, ¿a dónde vamos?" }
  ],
  "location": { "lat": 19.0414, "lng": -98.2063 },
  "userName": "Ana"
}
```

- Solo `message` es obligatorio (1–1000 caracteres, no solo espacios).
- `history`: máximo 20 turnos (`role` `user` | `assistant`, `content` ≤ 4000). El servidor no guarda sesiones: el cliente debe reenviar el historial con el `reply` **exacto** de cada respuesta.
- Se rechazan campos no declarados (400).
- Header `x-api-key` obligatorio si `CHAT_API_KEY` está configurada.

Respuesta `200` (estructura general):

```json
{
  "reply": "Itinerario sugerido para conocer Puebla en 3 días:\n\n**Día 1**\n\n1. **…**",
  "format": "markdown",
  "kind": "itinerary",
  "code": "found",
  "provider": "groq",
  "places": [{ "id": "uuid", "name": "…", "state": "Puebla", "category": "Histórico", "description": "…" }],
  "suggestions": ["¿Qué hay cerca de mí?", "Arma mi itinerario", "Comida típica de la zona", "Cómo llegar"],
  "itinerary": { "requestedDays": 3, "days": [{ "day": 1, "placeIds": ["uuid"] }] }
}
```

- Siete campos fijos (`reply`, `format`, `kind`, `code`, `provider`, `places`, `suggestions`); `itinerary` **solo** existe en `kind: "itinerary"` con duración reconocida.
- `kind`: `conversation` · `recommendation` · `itinerary` · `notice` · `empty`. `code`: estado técnico estable (p. ej. `found`, `selection-fallback`, `selection-empty`, `exhausted`, `type-unverified`, `itinerary-days-out-of-range`).
- Errores: `{ statusCode, message, error: { code, message, retryable } }` (400 `invalid_request`, 401 `unauthorized`, 404 `not_found`, 413 `payload_too_large`, 429 `rate_limited`, 503 `unavailable`, otros `internal`).

Contrato completo: [docs/chatbot/CONTRATO_RESPUESTAS.md](docs/chatbot/CONTRATO_RESPUESTAS.md).

### `GET /health`

`{ status, strategy, primary, providers: { gemini, groq } }`: estado del servicio y qué proveedores tienen llave (no expone las llaves). Render lo usa como health check. `GET /` devuelve `{ name, status }`.

## Variables de entorno

Copia `.env.example` a `.env` en local o configúralas en el panel de Render. **No subas `.env` al repositorio.**

| Variable | Default | Descripción |
|---|---|---|
| `GEMINI_API_KEY` | — | Llave de Gemini |
| `GROQ_API_KEY` | — | Llave de Groq |
| `GEMINI_MODEL` | `gemini-3.6-flash` | Modelo de Gemini |
| `GROQ_MODEL` | `openai/gpt-oss-120b` | Modelo de Groq |
| `PRIMARY_PROVIDER` | `gemini` | `gemini` o `groq` |
| `CHAT_STRATEGY` | `fallback` | `fallback` (uno y luego el otro) o `race` (ambos a la vez) |
| `PROVIDER_TIMEOUT_MS` | `25000` | Tiempo máximo por proveedor |
| `MAX_OUTPUT_TOKENS` | `4096` | Tope de tokens de salida |
| `MXGUIDE_API_URL` | — | URL del backend principal (http/https, sin credenciales ni query). Vacía = sin catálogo: la conversación funciona y las consultas turísticas reciben aviso |
| `PLACES_TIMEOUT_MS` | `15000` | Tiempo máximo para el catálogo |
| `CHAT_API_KEY` | — | Si se llena, la app debe mandar `x-api-key` |
| `CORS_ORIGINS` | todos | Orígenes permitidos separados por coma |
| `RATE_LIMIT_PER_MINUTE` | `20` | Peticiones por minuto por IP |
| `PORT` | `3000` | Render lo asigna |
| `LOG_LEVEL` | `log` (`error` en pruebas) | `error` · `warn` · `log` · `debug` · `verbose` |

Se necesita **al menos una** llave de IA; si falta o un valor es inválido, el servidor no arranca e indica por qué.

## Ejecutar en local

Requisitos: Node 20 o superior (recomendado 22, ver `.nvmrc`) y npm.

```bash
npm ci                      # o npm install
cp .env.example .env        # en Windows: copy .env.example .env
# llena GEMINI_API_KEY y/o GROQ_API_KEY y MXGUIDE_API_URL en .env
npm run start:dev           # compila (tsc) y arranca en http://localhost:3000
```

Scripts disponibles (`package.json`):

| Comando | Qué hace |
|---|---|
| `npm run build` | Compila a `dist/` (`tsc -p tsconfig.build.json`) |
| `npm run start:dev` | `build` + `node dist/main.js` (no recarga en caliente) |
| `npm run start:prod` / `npm start` | `node dist/main.js` (requiere `build` previo) |
| `npm run typecheck` | Verificación de tipos (`tsc --noEmit`) |
| `npm test` | Suite Jest completa (proveedores y catálogo simulados) |
| `npm run test:watch` | Jest en modo observación |

Prueba rápida (PowerShell):

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:3000/chat -ContentType 'application/json' -Body '{"message":"Planéame 2 días en Oaxaca"}'
```

Con `LOG_LEVEL=log`, cada petición registra una línea `chat {…}` con metadatos de diagnóstico (ruta, estado del catálogo, intención, candidatos, seleccionados, proveedor, `kind`, `code`, duración), **sin** mensajes, historial ni datos personales.

Para pruebas manuales con historial en Postman: [docs/chatbot/PRUEBAS_POSTMAN.md](docs/chatbot/PRUEBAS_POSTMAN.md) y el procedimiento de la carpeta «Seguimientos e itinerarios» descrito en [docs/chatbot/RESUMEN_CAMBIOS_MICTLAN.md](docs/chatbot/RESUMEN_CAMBIOS_MICTLAN.md) (sección «Pruebas»).

## Desplegar en Render

`render.yaml` define el servicio (Blueprint): build `npm ci && npm run build`, start `npm run start:prod`, health check `/health`, Node 22. Las llaves se piden en el panel (`sync: false`) y `CHAT_API_KEY` se genera automáticamente. El plan gratuito duerme el servicio tras inactividad; el primer mensaje tarda más. El backend principal también puede estar dormido: si tarda más que `PLACES_TIMEOUT_MS`, las consultas turísticas responden un aviso `timeout`. Más detalle: [docs/chatbot/DESPLIEGUE_RENDER.md](docs/chatbot/DESPLIEGUE_RENDER.md).

## Estructura

```
src/
├── main.ts                       # arranque, niveles de log
├── app.module.ts                 # límite de peticiones global
├── config/                       # variables de entorno validadas
├── health/                       # GET / y GET /health
├── common/                       # x-api-key, HTTP (helmet, CORS, validación), errores seguros,
│                                 # lectura acotada de datos externos y redacción, diagnóstico
├── places/
│   ├── places.service.ts         # catálogo: estado, intención, tipos, cercanía, enrutamiento
│   ├── state-resolver.ts / state-hints.ts   # estados y continuaciones
│   ├── tourism-intent.ts / place-types.ts   # intenciones y tipos sin categoría
│   ├── itinerary.ts              # detección, duración y seguimientos de itinerarios
│   ├── itinerary-plan.ts         # distribución por días (función pura)
│   └── followup-context.ts       # «de esos» / «¿qué más?» sobre la respuesta anterior
└── chat/
    ├── chat.controller.ts        # POST /chat
    ├── chat.service.ts           # orquestación, conversación, avisos, diagnóstico
    ├── verified-recommendation.ts# validación de selección y presentación
    ├── conversation-guard.ts     # guarda de la conversación libre
    ├── response-contract.ts      # contrato y Markdown seguro
    ├── prompt.ts                 # instrucciones de selector y conversación
    ├── dto/                      # validación del cuerpo
    └── providers/                # Gemini y Groq
test/                             # 18 suites Jest
```

## Documentación

| Documento | Contenido |
|---|---|
| [docs/chatbot/RESUMEN_CAMBIOS_MICTLAN.md](docs/chatbot/RESUMEN_CAMBIOS_MICTLAN.md) | Qué aporta la rama `mictlan` respecto a `main` |
| [docs/chatbot/CONTRATO_RESPUESTAS.md](docs/chatbot/CONTRATO_RESPUESTAS.md) | Contrato de `POST /chat`, códigos y campo `itinerary` |
| [docs/chatbot/ITINERARIOS_SENCILLOS.md](docs/chatbot/ITINERARIOS_SENCILLOS.md) | Itinerarios: detección, duración, distribución y seguimientos |
| [docs/chatbot/INTEGRACION_FLUTTER.md](docs/chatbot/INTEGRACION_FLUTTER.md) | Guía para el equipo de Flutter |
| [docs/chatbot/PRUEBAS_POSTMAN.md](docs/chatbot/PRUEBAS_POSTMAN.md) | Pruebas manuales |
| [docs/chatbot/DESPLIEGUE_RENDER.md](docs/chatbot/DESPLIEGUE_RENDER.md) | Despliegue |
| `docs/chatbot/` (resto) | Auditoría, decisiones técnicas, categorías, veracidad y seguridad por fase |

## Agregar otro proveedor de IA

1. Crea `src/chat/providers/<nombre>.provider.ts` que implemente `LlmProvider` (ver `groq.provider.ts`).
2. Agrégalo a `LLM_PROVIDERS` en `src/chat/chat.module.ts`.
3. Suma su nombre a `ProviderName` y a `PRIMARY_PROVIDER` en `src/config/env.ts`.
