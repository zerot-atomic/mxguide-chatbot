# Decisiones técnicas de fase 1

## Estados y conversación
El índice proviene exclusivamente de GET /states (UUID y nombre). Caché en memoria de diez minutos, con una promesa compartida para refrescos concurrentes. Un refresco fallido no se almacena como éxito ni utiliza datos vencidos. No hay UUID de estados fijados en producción.

Se normalizan acentos, mayúsculas, puntuación y espacios; se buscan nombres completos con límites de palabra y se prefieren nombres compuestos largos sobre coincidencias contenidas. Ciudad de México y Estado de México son entidades distintas. México aislado solicita precisión. Múltiples estados o negaciones detectadas requieren aclaración, incluso cuando un humano podría resolverlas.

El mensaje actual tiene prioridad. Solo ciertos prefijos de continuación consultan el último mensaje de usuario entre los doce turnos recientes; no se infiere un destino desde mensajes de assistant. No se promete comprender lenguaje natural arbitrario, apodos o abreviaturas. Un nombre desconocido acompañado de la palabra estado produce un resultado no reconocido; no existe detección exhaustiva de entidades geográficas desconocidas.

## Selección territorial y ubicación
Un estado explícito gana sobre las coordenadas. Se consulta /places?stateId=UUID&limit=15, se excluyen registros con stateId distinto o ausente, se deduplica por ID y se limita localmente a 15. Un registro defectuoso no invalida los demás. No se sustituye por otro catálogo. El orden territorial es el recibido; no se afirma cercanía.

Sin estado, una ubicación válida conserva nearby. Cerca de mí sin coordenadas solicita ubicación. Sin estado ni ubicación se conservan destacados, con caché de diez minutos y máximo local de 20. Para resolver la prioridad territorial se carga primero /states: si ese catálogo falla también se bloquea la selección general o cercana; queda como limitación de disponibilidad. Cada petición HTTP tiene el timeout existente; no se añadió un presupuesto global.

## Top 10 cercanos
Solo se admiten IDs con sintaxis UUID y nombres no vacíos. Se acepta distanceKm exclusivamente si es de tipo number, finito y no negativo; cero es válido. Se excluyen distancias ausentes, null, cadenas numéricas o vacías, booleanos, negativas, NaN e Infinity. No se inventan distancias ni se convierten strings automáticamente.

Se ordena por distancia original sin redondear y, en empate, por ID mediante comparación lexicográfica. Después se deduplica por ID: la menor distancia válida gana. Para el mismo ID y la misma distancia se conserva la primera aparición. Se toman como máximo diez. Los IDs originales se mantienen para las tarjetas. Son los más cercanos entre los resultados recibidos, no necesariamente los más cercanos de toda la base. Si una respuesta no vacía no contiene ningún registro utilizable se clasifica como malformada, no como ausencia de lugares.

## Errores, respuesta y proveedores
Se distinguen found, empty, ambiguous, unrecognized, missing-location, http, timeout, connection, malformed y unconfigured. Solo found invoca IA. Los demás producen avisos locales controlados, sin inventar destinos, con places vacío. El campo provider mantiene su tipo gemini|groq: en avisos locales indica el primer proveedor configurado seleccionado, sin afirmar que hubo una llamada. Esta es una ampliación explícita de su semántica anterior; no se añade un valor incompatible con Flutter.

Los avisos conservan HTTP 200 y reply/provider/places/suggestions. Sin proveedores configurados se conserva 503. Las estrategias fallback y race y los adaptadores Gemini/Groq no cambian. Los logs de orquestación ya no incluyen mensajes o cuerpos de errores potencialmente sensibles.

El prompt solo recomienda candidatos confirmados y distingue información cultural general. No se envían IDs ni campos internos innecesarios al modelo. Las tarjetas se asocian por nombre normalizado con límites de palabras; se omiten nombres duplicados o contenidos en otros candidatos para evitar asociaciones dudosas. Esta heurística puede omitir tarjetas válidas y no interpreta negaciones en la respuesta de IA; no es extracción semántica estructurada.

No se modifican DTO, controlador, .env, README principal, Flutter, backend principal, base de datos, Render ni proveedores. No hay migraciones, despliegue, commits o push.
