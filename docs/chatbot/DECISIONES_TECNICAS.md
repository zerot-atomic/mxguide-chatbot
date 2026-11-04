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

## Fase 2: categorías
Ver FASE2_CATEGORIAS.md para los siete nombres oficiales, reglas y limitaciones. Se reutilizan solo asociaciones recibidas, sin UUID fijos o endpoints nuevos. El Top 10 general no depende de categorías. Una consulta específica sin categorías disponibles devuelve un aviso local; no hace N+1 ni inventa tipos. Se mantiene el contrato público incluido provider para avisos locales, según la decisión de fase 1.

## Actualización: recuperación frente a selección
Las consultas estatales específicas recuperan una muestra de hasta 100; generales solicitan 15. Todas siguen seleccionando como máximo 15 candidatos para IA. Esta decisión sustituye el límite remoto uniforme de fase 1 y la primera implementación de fase 2. No introduce paginación ni exhaustividad; cero coincidencias solo se refiere a la muestra. Nearby y su orden de selección siguen iguales.

## Fase 3: identidad y texto público
La salida del modelo selecciona IDs y nunca proporciona datos de tarjetas o texto público. El servidor valida membresía exacta y genera reply desde los mismos objetos de places. Esta decisión sustituye la asociación por nombres en el flujo y la publicación directa de prosa. Ante selección inválida se usa fallback local sin nuevos consumos de IA. JSON es una convención de texto con validación local, no una función nativa supuesta de los proveedores. Detalles y limitaciones de redacción en FASE3_VERACIDAD.md.

## Fase 4: límites de confianza
Las instrucciones de sistema son estáticas. Query y candidatos se envían como JSON de datos en rol user; historial solo se utiliza localmente. El filtro de IDs y renderer de fase 3 son la barrera efectiva, no una detección por palabras de ataques. La IA no adquiere herramientas ni capacidad de elegir destinos HTTP.
Se limitan bytes de respuestas externas, se rechazan redirects y se sanitizan errores sin cuerpos remotos. Parser JSON de 64 KiB y filtro público comparten configuración entre pruebas y bootstrap. No se cambia el esquema x-api-key, la estrategia ni provider para avisos locales; sus limitaciones se documentan. Menos contexto personal, sin prometer anonimización completa de preguntas libres. Cambios de JWT, proxy/infraestructura o contrato requieren coordinación y aprobación futura. Ver FASE4_SEGURIDAD.md.

## Itinerarios sencillos
Se mantiene Intent como categoría de selección y se añade un flag interno de itinerario para presentación, sin campos públicos ni cambios de API del modelo. Esto evita perder filtros como historic/culture al pedir un recorrido. Solo listas ordenadas de candidatos verificados; no hay cálculo de rutas, horarios o duración. Faltando estado inequívoco se pide aclaración aunque exista location. Se excluyen hospedaje/gastronomía del itinerario general y categorías mixtas sensibles; hospedaje explícito admite alojamientos, gastronomía sin subtipo confirmado no se presenta como paradas visitables. El orden del modelo o del fallback no acredita optimización ni viabilidad de un día. Memoria local de doce turnos y protección por IDs se mantienen. Parser de referencias anteriores admite también listas numeradas, sin confiar en sus hechos como autoridad. Detalles en ITINERARIOS_SENCILLOS.md.
