# Cambios de fase 1

## Archivos
- src/places/state-resolver.ts (nuevo): catálogo dinámico, normalización y resolución conservadora.
- src/places/places.service.ts: GET /states con caché y refresco compartido; GET /places?stateId=UUID&limit=15; adaptación tolerante; resultados internos tipados; ranking local de cercanos.
- src/chat/chat.service.ts: selección territorial antes de IA, avisos locales, sugerencias según contexto, asociación conservadora de tarjetas y sanitización de logs.
- src/chat/prompt.ts: alcance territorial correcto y recomendaciones limitadas a candidatos confirmados.
- test/catalog.spec.ts (nuevo): pruebas de resolución, catálogo HTTP, ranking y POST /chat con servicio real y backend simulado.
- test/chat.spec.ts: fixtures compatibles con UUID y resultado interno; aislamiento explícito del servicio de catálogo.
- docs/chatbot/AUDITORIA.md, CAMBIOS.md, DECISIONES_TECNICAS.md y PRUEBAS_POSTMAN.md: evidencia, decisiones, validación y pasos manuales pendientes.

## Límites independientes
Estado: hasta 15 candidatos con pertenencia comprobada. Cercanos: hasta 10 IDs únicos válidos ordenados por distancia numérica finita no negativa y luego por ID. Destacados: hasta 20. Tarjetas: hasta cinco lugares mencionados sin asociación ambigua. Las distancias no se redondean antes del ranking ni se inventan cuando faltan.

## Validación ejecutada
- npm test -- --runInBand --no-cache: 2 suites y 71 pruebas aprobadas.
- npm run typecheck: aprobado.
- npm run build: aprobado.
- Incluye 32 nombres del catálogo de prueba, estados compuestos, negaciones, ambigüedad, ubicación, historial, caché concurrente y expirada, errores, JSON inválido, categorías nulas, límites locales y compatibilidad HTTP.
- La prueba de 155 registros invierte el orden, incluye duplicados e IDs/distancias inválidos, verifica exactamente diez IDs esperados, contexto enviado a IA simulada y tarjeta con ID original. Otra prueba verifica empates por ID y precisión sin redondear.
- Gemini, Groq y el backend están simulados en las pruebas. No se consumieron llamadas reales de IA.
- Jest falla dentro del sandbox por EPERM al renombrar su caché temporal; la ejecución autorizada fuera del sandbox pasa. Se corrigió un fallo detectado por la suite: DOMException de timeout no debe depender de instanceof Error entre distintos contextos de ejecución.

## Compatibilidad y limitaciones
Se conserva POST /chat con reply, provider, places y suggestions y las estrategias existentes. Estado explícito prevalece sobre ubicación. Los avisos locales no consumen IA; provider identifica en ellos al proveedor seleccionado. El reconocimiento es heurístico, no comprende toda expresión natural ni abreviaturas. La asociación por nombres puede omitir tarjetas y no interpreta el significado completo de la respuesta. La selección depende de /states y los timeouts son por petición, no globales. Ver DECISIONES_TECNICAS.md.

No se hicieron pruebas manuales nuevas con IA ni despliegues. Los pasos de Postman de fase 1 están pendientes. Rama conservada: chatbot/filtro-estados. No se modificaron .env, README principal, Flutter, proveedores, Render, backend ni base de datos. Sin commits ni push.

## Fase 2
Implementado clasificador local src/places/tourism-intent.ts y pruebas test/tourism-intent.spec.ts. Modificados places.service.ts, chat.service.ts y prompt.ts para filtrar todas las asociaciones antes de limitar candidatos, preservar cercanía general y explicar limitaciones. Sin cambios de DTO, controladores o proveedores. Evidencia, reglas y soporte parcial del backend en FASE2_CATEGORIAS.md. No se declara completo el filtrado cercano por categoría: nearby verificado no aporta categorías. Tampoco existe distinción contractual restaurantes/platillos.

## Corrección provisional autorizada de fase 2
Recuperación estatal específica ampliada a 100 mediante el parámetro limit ya verificado; general conserva 15. Máximo enviado a IA: 15, después de filtro y deduplicación. Sin cambios de cercanía, Flutter o proveedores. Regresión de comida típica en Puebla con coincidencias fuera del primer lote y verificación del prompt; prueba de aviso de muestra vacía sin IA. Ver FASE2_CATEGORIAS.md. No garantiza exhaustividad; filtro remoto por categoría o paginación documentada siguen pendientes del backend principal.

Validación final de la corrección: npm test -- --runInBand --no-cache → 3 suites, 101 pruebas aprobadas; npm run typecheck y npm run build → aprobados. Incluye las regresiones existentes de fase 1 y fase 2. No se consumieron llamadas reales a Gemini/Groq. Sin commits, push ni despliegues.

## Fase 3
Validación de selección JSON interna de hasta cinco IDs contra candidatos reales, seguida de reply controlado y tarjetas con objetos originales. Salidas inválidas o parcialmente válidas generan respuesta segura de hasta tres candidatos sin llamadas extra. Se deja de publicar prosa del modelo y de asociar tarjetas por nombre. Archivos: src/chat/verified-recommendation.ts (nuevo), chat.service.ts, prompt.ts; test/verified-recommendation.spec.ts (nuevo) y fixtures previos. Ver FASE3_VERACIDAD.md para semántica, redacción restringida y riesgos pendientes. Clientes y estrategias sin cambios. 125 pruebas en cuatro suites, typecheck y build aprobados; sin llamadas reales a IA, commits, push o despliegues.

## Fase 4: seguridad y resiliencia
Sistema estático y candidatos/query en JSON user; historial y nombre no enviados a IA; redacción de secretos conocidos y patrones comunes. Lectura de JSON externo limitada (catálogo 2 MiB, proveedores 256 KiB), redirects rechazados, origen configurado validado y errores HTTP sin cuerpos remotos. Referencias externas reconocidas se omiten de tarjetas/texto. Entrada no vacía y coordenadas numéricas; configuración HTTP compartida con parser 64 KiB y errores públicos sanitizados. Autenticación opcional, rate limit, estrategias, filtros y contrato conservados.
Archivos nuevos: common/external-data.ts, common/configure-http.ts, common/safe-exception.filter.ts, test/security.spec.ts y docs/chatbot/FASE4_SEGURIDAD.md. Cambios en main, env, DTO, prompt, chat.service, verified-recommendation, places.service, helper HTTP de proveedores y assertions de contexto de tests anteriores. 188 tests en seis suites, typecheck y build aprobados. Ver FASE4_SEGURIDAD.md para riesgos potenciales, impacto y coordinación previa a despliegue. Sin llamadas reales a servicios, commits, push ni despliegues.
