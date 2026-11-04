# MXGuide Chatbot · MICHTLAN

API del asistente de viaje de **MXGuide**. La app manda el mensaje del usuario y este servicio
lo resuelve con agentes de IA (**Google Gemini** y **xAI Grok**), usando los lugares reales del
backend de MXGuide para recomendar solo lo que existe en la app.

```
App Flutter ──POST /chat──▶ mxguide-chatbot ──▶ Gemini  (principal)
                                │            └─▶ Grok    (respaldo)
                                └─GET /places/featured | /places/nearby──▶ mxguide-backend
```

Las llaves de IA viven **solo en este servidor**, nunca dentro de la app.

## Stack

- NestJS 11 + TypeScript, Node 22
- `fetch` nativo hacia las APIs REST de Gemini (`generateContent`) y Grok (Responses API `/v1/responses`); sin SDKs
- Validación con `class-validator`, límite de peticiones por IP con `@nestjs/throttler`, `helmet`

## Cómo deciden los agentes (`CHAT_STRATEGY`)

| Estrategia | Qué hace | Cuándo usarla |
|---|---|---|
| `fallback` (default) | Pregunta al `PRIMARY_PROVIDER`; si falla o tarda más de `PROVIDER_TIMEOUT_MS`, pregunta al otro | Recomendado: se paga una sola llamada por mensaje |
| `race` | Pregunta a los dos al mismo tiempo y usa la primera respuesta válida | Si importa más la velocidad que el costo (se paga doble) |

Con una sola llave configurada, funciona solo con ese proveedor.

## Endpoints

### `POST /chat`

```json
{
  "message": "¿Qué puedo visitar en Puebla este fin de semana?",
  "history": [
    { "role": "user", "content": "Hola" },
    { "role": "assistant", "content": "¡Hola! Soy Balam, ¿a dónde vamos?" }
  ],
  "location": { "lat": 19.0414, "lng": -98.2063 },
  "userName": "Jesús"
}
```

Solo `message` es obligatorio (1 a 1000 caracteres). `history`: máximo 20 turnos (se usan los últimos 12). `location`: opcional; si viene, el bot recomienda lugares cercanos.

Respuesta `200`:

```json
{
  "reply": "Te recomiendo la Catedral de Puebla y …",
  "provider": "gemini",
  "places": [
    { "id": "uuid", "name": "Catedral de Puebla", "state": "Puebla", "category": "Histórico", "description": "…", "distanceKm": 1.2 }
  ],
  "suggestions": ["Más lugares cerca", "Arma mi itinerario", "Comida típica de la zona", "Cómo llegar"]
}
```

- `places`: lugares del catálogo de MXGuide que la respuesta menciona; la app los pinta como tarjetas (el `id` es el mismo de `GET /places/:id`).
- Errores: `400` cuerpo inválido · `401` falta o no coincide `x-api-key` · `429` demasiadas peticiones · `503` ningún agente respondió.

### `GET /health`

Estado del servicio y qué proveedores tienen llave. Render lo usa como health check.

## Variables de entorno

Copia `.env.example` a `.env` (en local) o llénalas en el panel de Render.

| Variable | Default | Descripción |
|---|---|---|
| `GEMINI_API_KEY` | — | Llave de [Google AI Studio](https://aistudio.google.com/apikey) |
| `XAI_API_KEY` | — | Llave de [xAI Console](https://console.x.ai) |
| `GEMINI_MODEL` | `gemini-3.6-flash` | Modelo de Gemini |
| `GROK_MODEL` | `grok-4.7` | Modelo de Grok |
| `PRIMARY_PROVIDER` | `gemini` | `gemini` o `grok` |
| `CHAT_STRATEGY` | `fallback` | `fallback` o `race` |
| `PROVIDER_TIMEOUT_MS` | `25000` | Tiempo máximo por proveedor |
| `MAX_OUTPUT_TOKENS` | `2048` | Tope de tokens de respuesta (Gemini) |
| `MXGUIDE_API_URL` | — | URL del backend de MXGuide (sin `/` al final). Vacío = el bot no usa el catálogo |
| `PLACES_TIMEOUT_MS` | `15000` | Tiempo máximo para traer lugares |
| `CHAT_API_KEY` | — | Si se llena, la app debe mandar el header `x-api-key` |
| `CORS_ORIGINS` | todos | Orígenes permitidos separados por coma (solo importa para Flutter Web) |
| `RATE_LIMIT_PER_MINUTE` | `20` | Peticiones por minuto por IP |
| `PORT` | `3000` | Render lo pone solo |

Se necesita **al menos una** de `GEMINI_API_KEY` o `XAI_API_KEY`; si falta o hay un valor inválido, el servidor no arranca y dice por qué.

## Correr en local

```bash
npm install
cp .env.example .env        # en Windows: copy .env.example .env
# llena GEMINI_API_KEY y/o XAI_API_KEY en .env
npm run start:dev
```

Prueba (PowerShell):

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:3000/chat -ContentType 'application/json' -Body '{"message":"¿Qué visito en Oaxaca?"}'
```

Pruebas automáticas (no gastan llamadas reales, usan agentes simulados):

```bash
npm test
```

## Desplegar en Render

**Opción A — Blueprint (recomendado):** sube este repo a GitHub → en Render **New + → Blueprint** → elige el repo. Lee `render.yaml`, te pide `GEMINI_API_KEY` y `XAI_API_KEY`, y genera `CHAT_API_KEY` solo.

**Opción B — Manual:** **New + → Web Service** → el repo, y configura:

- Runtime: Node · Build: `npm ci && npm run build` · Start: `npm run start:prod`
- Health check path: `/health`
- Environment: las variables de la tabla de arriba

El plan gratis duerme el servicio tras 15 minutos sin uso; el primer mensaje después de eso tarda más.

## Conectar la app Flutter

En la app, un servicio que llame a este API (la URL y la llave van en `--dart-define`, no escritas en el código):

```dart
final response = await http.post(
  Uri.parse('$chatbotUrl/chat'),
  headers: {'Content-Type': 'application/json', 'x-api-key': chatApiKey},
  body: jsonEncode({
    'message': texto,
    'history': historial, // [{'role': 'user'|'assistant', 'content': '...'}]
    'userName': AuthService.instance.user?.name,
    if (ubicacion != null) 'location': {'lat': ubicacion.latitude, 'lng': ubicacion.longitude},
  }),
).timeout(const Duration(seconds: 60));
```

`CHAT_API_KEY` dentro de la app frena el abuso casual, pero se puede extraer del APK; el límite por IP es la segunda barrera. Si después quieren que solo usuarios logueados usen el chat, el siguiente paso es validar el JWT del backend principal en este servicio.

## Agregar otro agente (OpenAI, Claude, etc.)

1. Crea `src/chat/providers/<nombre>.provider.ts` que implemente `LlmProvider` (mira `grok.provider.ts`).
2. Agrégalo a la lista `LLM_PROVIDERS` en `src/chat/chat.module.ts`.
3. Suma su nombre a `ProviderName` y a `PRIMARY_PROVIDER` en `src/config/env.ts`.

## Ajustar la personalidad

Las reglas de Balam (tono, longitud, qué no inventar) están en `src/chat/prompt.ts`.

## Estructura

```
src/
├── main.ts                    # arranque: helmet, CORS, validación, trust proxy
├── app.module.ts              # rate limit global
├── config/                    # lectura y validación de variables de entorno
├── health/                    # GET / y GET /health
├── common/api-key.guard.ts    # header x-api-key opcional
├── places/places.service.ts   # lugares del backend de MXGuide (con caché)
└── chat/
    ├── chat.controller.ts     # POST /chat
    ├── chat.service.ts        # orquestador fallback / race
    ├── prompt.ts              # personalidad y reglas de Balam
    ├── dto/                   # validación del cuerpo
    └── providers/             # Gemini y Grok
test/chat.spec.ts              # pruebas con agentes simulados
```
"# mxguide-chatbot" 
