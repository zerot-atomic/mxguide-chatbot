# Resumen de cambios — rama `mictlan` respecto a `main`

Este documento explica qué aporta la rama `mictlan` frente a `main`, comparando el código de ambas. No describe despliegues: **a la fecha de este documento los cambios no están desplegados en Render ni la app Flutter está adaptada**.

- `main`: commit `1962fb2` (renombre a Mictlán sobre el chatbot original).
- `mictlan`: parte de `chatbot/filtro-estados` (`167e4c4`), commit `e996ec8` (motor híbrido) y, sin confirmar al redactar esto, las etapas de itinerarios y correcciones posteriores.

## Qué ya existía en `main` (no es nuevo)

- API NestJS 11 con `POST /chat`, `GET /` y `GET /health`.
- Proveedores **Gemini** y **Groq** por REST, estrategias `fallback` y `race`.
- Validación del cuerpo (`class-validator`, sin campos extra), `helmet`, CORS, límite de peticiones por IP, `x-api-key` opcional. Los errores usaban el formato por defecto de Nest.
- Catálogo de MXGuide solo como **destacados** (`/places/featured`, con caché) o **cercanos** (`/places/nearby`) incluidos en el prompt.
- El modelo redactaba **texto libre** con los últimos 12 turnos; las tarjetas se obtenían buscando nombres del catálogo dentro del texto.
- Respuesta con cuatro campos: `reply`, `provider`, `places`, `suggestions`.
- 1 suite con 18 pruebas.

## 1. Objetivo de la actualización

Unificar la **conversación natural** de `main` con la **precisión** de `chatbot/filtro-estados`:

- `main` no filtraba por estado ni por categoría: «lugares en Oaxaca» podía devolver destacados de otros estados.
- El texto libre podía mencionar destinos, precios u horarios que no están en el catálogo.
- No había un contrato que indicara el formato del `reply` (origen de problemas de visualización de Markdown en Flutter).
- `filtro-estados` resolvía la precisión, pero eliminaba la conversación y el historial.
- No existían itinerarios por días ni registros de diagnóstico útiles.

## 2. Cambios en el motor conversacional

- **Enrutador local** (sin IA): distingue conversación general de consulta turística por estado mencionado, intención, tipo de lugar, cercanía, palabras de recomendación o seguimientos. Sin señal turística no consulta `/states` ni `/places`.
- **Conversación**: estilo de `main` con historial (12 turnos) **redactado**; sin catálogo, ubicación ni nombre del usuario; guarda que sustituye respuestas con precios, horarios, teléfonos o lugares concretos no verificados (`code: conversation-guarded`).
- **Consulta turística**: el modelo solo **selecciona IDs** entre candidatos (`{"placeIds":[…],"message":"…"}`), sin historial. Una introducción breve del modelo se acepta solo si no nombra lugares ajenos al estado consultado, cifras, enlaces, Markdown ni datos operativos.
- **Redacción de datos personales** en mensaje, historial y consulta del selector: llaves, `Bearer`, correos, enlaces, teléfonos, CURP, RFC, tarjetas, direcciones, código postal, coordenadas y «me llamo…»; el saludo personalizado se quita del historial antes de enviarlo al modelo.
- **Muletillas** («perdón», «no,», «oye», «ok», «bueno», «entonces», «mmm»…) no rompen la detección de seguimientos ni se leen como exclusiones.

## 3. Recomendaciones turísticas

- Resolución de **estado** con `/states` del catálogo; aclaración ante varios estados, exclusiones o «México» ambiguo.
- **Intenciones** con categorías del catálogo (Histórico, Arqueológico, Cultural, Natural, Religioso, Hospedaje, Gastronomía) y muestras de 15 o 100 registros según el caso.
- **Tipos sin categoría** (playas, cenotes, tours, pueblos mágicos, balnearios, vida nocturna): solo registros que los mencionan; si no, aviso `type-unverified` sin IA.
- **Lista blanca**: solo UUID de candidatos filtrados, sin duplicados, con máximo por respuesta; salida inválida → respaldo determinista (`selection-fallback`); selección vacía → `selection-empty`.
- Textos del catálogo saneados para Markdown; descripciones filtradas si contienen datos operativos, enlaces o instrucciones.
- Fallos del catálogo (`timeout`, `http`, `malformed`, `unconfigured`…) responden avisos 200 sin inventar destinos.

## 4. Seguimientos

- Estado heredado del historial solo en continuaciones reconocidas («¿y en X?», «¿y cuáles más?», «de esos», «¿qué más?») o con señal turística; un «¿y…?» de otro tema es conversación.
- «De esos» y «¿qué más?» leen la respuesta anterior (viñetas o listas numeradas hasta 21; formatos anteriores incluidos). «¿Qué más?» excluye lo ya mostrado y responde `exhausted` si no queda nada.
- Una charla intermedia no relacionada corta la cadena.

## 5. Itinerarios

- **Detección**: «itinerario», «recorrido», «planea mi viaje a X», «planéame N días en X», «¿qué puedo hacer N días en X?», «ruta por X», «organízame un fin de semana en X», «quiero recorrer X durante un día».
- **Duración**: solo la explícita, 1–7 días («fin de semana» = 2, «una semana» = 7). Sin duración se conserva el comportamiento anterior (hasta 5 destinos, sin días). **Más de 7 días**: aviso `itinerary-days-out-of-range` que pide elegir de 1 a 7, sin lista ni IA; el siguiente mensaje («Perdón, mejor 5 días») continúa el itinerario en el mismo estado.
- **Distribución** (`src/places/itinerary-plan.ts`, en el backend): objetivo mín(días × 3, 21, candidatos); hasta 30 candidatos del estado; reparto equilibrado (10 en 4 días → 3, 3, 2, 2), alternancia de categorías cuando hay variedad, sin duplicados ni días vacíos; con menos destinos que días se informan los días libres.
- **Seguimiento**: «¿Y en Oaxaca?», «¿Y uno cultural?», «Mejor que sean 2 días», «Agrega un museo», «¿Qué más?», duraciones aisladas («5 días») solo si el turno anterior del usuario era un itinerario.
- **Bloqueos**: itinerarios de comida (`itinerary-food-unverified`); sin estado, `itinerary-missing-state`.
- Sin horarios, duración de visitas, traslados, distancias, costos ni rutas optimizadas.

Detalle: [ITINERARIOS_SENCILLOS.md](ITINERARIOS_SENCILLOS.md).

## 6. Contrato HTTP

Cambios **aditivos** (los campos de `main` se conservan):

| Campo | `main` | `mictlan` |
|---|---|---|
| `reply` | Texto libre del modelo, sin formato declarado | Markdown limitado (párrafos, listas, negritas; sin enlaces, encabezados, tablas ni HTML) |
| `format` | — | `"markdown"` |
| `kind` | — | `conversation` · `recommendation` · `itinerary` · `notice` · `empty` |
| `code` | — | Estado técnico estable (`found`, `selection-fallback`, `selection-empty`, `exhausted`, `type-unverified`, `itinerary-days-out-of-range`, estados del catálogo…) |
| `places` | Hasta 5, por coincidencia de nombres en el texto | Solo IDs validados; hasta 5, o hasta 21 en itinerarios con duración |
| `itinerary` | — | Opcional, solo en `kind: itinerary` con duración: `{ requestedDays, days: [{ day, placeIds }] }`; concatenación de `placeIds` = `places` |
| Errores | Formato por defecto de Nest (`statusCode`, `message` con detalles de validación, `error`) | Sanitizados: `{ statusCode, message, error: { code, message, retryable } }`, sin detalles internos |

Contrato completo: [CONTRATO_RESPUESTAS.md](CONTRATO_RESPUESTAS.md). Guía para la app: [INTEGRACION_FLUTTER.md](INTEGRACION_FLUTTER.md).

## 7. Diagnósticos y privacidad

- `LOG_LEVEL` (`log` por defecto; `error` en pruebas).
- Una línea `chat {…}` por petición con: `requestId`, ruta (`conversation`/`catalog`/`notice`), estado del catálogo, intención, modo, `stateId`, tipo pedido, modo itinerario, días pedidos y planificados, candidatos, seleccionados, proveedor, `kind`, `code`, resultado, clase de error, número de turnos, si hubo ubicación y duración.
- Avisos con motivos técnicos fijos: fallos de proveedor («HTTP 429», «tiempo agotado») y del catálogo (endpoint sin parámetros de consulta).
- **No se registran** mensajes, historial, nombres, coordenadas, credenciales, respuestas del modelo, cuerpos de error remotos ni textos del catálogo.

## 8. Pruebas

Resultados ejecutados al preparar esta documentación (proveedores y catálogo simulados):

| Rama | Suites | Pruebas |
|---|---|---|
| `main` | 1 | 18 (todas pasan) |
| `mictlan` | 18 | 712 (todas pasan) |

- `npm run typecheck` y `npm run build` sin errores.
- Regresión de filtrado: la suite heredada de `filtro-estados` se ejecutó contra el código final comparando las tarjetas de 228 llamadas; solo cambian los casos de «itinerario de un día» (de 5 a 3 destinos por la regla de 3 por día).
- Pruebas manuales en Postman con Groq y el catálogo real **reportadas por el equipo** como satisfactorias: conversación, recomendaciones por estado, tipos sin categoría, seguimientos, itinerarios con duración, corte de contexto y corrección «10 días → Perdón, mejor 5 días». Para repetirlas, el cliente debe reenviar `history` con el `reply` exacto (por ejemplo, con scripts de colección en Postman que guarden los turnos en una variable).

## 9. Beneficios respecto a `main`

- Las recomendaciones respetan el estado y la categoría pedidos; las tarjetas solo provienen de IDs validados del catálogo.
- Se reducen los datos inventados: el modelo no redacta destinos en consultas turísticas y la conversación tiene guardas.
- Respuestas predecibles para la app: `format`, `kind` y `code` permiten decidir la UI sin interpretar texto; Markdown seguro.
- La conversación general sigue siendo natural y no consulta el catálogo innecesariamente; un saludo no espera al backend principal.
- Seguimientos conversacionales con contexto, incluso con muletillas.
- Itinerarios de 1 a 7 días organizados por día por el backend, con límites claros y sin días ni destinos inventados.
- Menor exposición de datos personales hacia el proveedor de IA y diagnóstico útil sin registrar contenido.
- Cobertura de pruebas de 18 a 712.

## 10. Limitaciones conocidas y trabajo futuro

- **Geolocalización y rutas**: el catálogo no confirma coordenadas en `/places`; no hay optimización geográfica ni distancias entre paradas. El orden de un itinerario no es una ruta.
- **Caché**: solo estados y destacados (10 minutos, en memoria). Sin caché por estado ni por cercanía.
- **Muestra del catálogo**: 15/100 registros por estado, 30 candidatos en itinerarios; no hay filtro remoto por categoría.
- **Tarjetas**: un itinerario puede traer hasta 21; Flutter debe revisar la interfaz.
- **Detección por patrones** (intenciones, seguimientos, muletillas): frases no previstas caen en conversación, no en datos inventados. «¿Qué clima hace en Oaxaca?» se trata como consulta del estado.
- **Selección con listas largas**: el modelo puede fallar el formato con más IDs; se aplica `selection-fallback` (visible en el diagnóstico).
- **Proveedores**: no se usa modo JSON nativo de Gemini/Groq. Durante las pruebas manuales Gemini respondió HTTP 403 y el servicio pasó a Groq; no se diagnosticó.
- **Fuera de alcance**: quitar destinos de un itinerario, varios estados, más de 7 días, comida y hospedaje como paradas, horarios, costos, autenticación de usuarios en el chat.
