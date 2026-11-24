# Fase 2: contratos y límite de integración

Inspección previa: estado y destacados incluyen asociaciones múltiples categories[].category.name; nearby solo tiene id, name, shortDescription, relevanceScore y distanceKm según la evidencia real de fase 0. El repo documenta /states, /places?stateId=UUID&limit=15, /places/featured, /places/nearby y una referencia a /places/:id para tarjetas. No hay contrato verificado de filtro por categoría, endpoint de categorías o consulta masiva de detalles. No se probarán parámetros o rutas inventadas ni se hará N+1.

El filtrado local por intención puede implementarse con asociaciones recibidas. Para nearby sin asociaciones no se puede afirmar un Top 10 por categoría: se devolverá una limitación explícita sin IA. Propuesta pendiente para el equipo del backend: incluir las asociaciones completas de categorías en nearby, o documentar un mecanismo masivo que preserve IDs y distancias. Esta fase no modifica ese backend. Una prueba con nearby enriquecido será una prueba de la lógica con mocks, no evidencia de soporte en producción.

## Categorías oficiales
Confirmadas por el usuario mediante la API real. Producción no fija estos UUID: compara nombres normalizados de asociaciones recibidas.

| Nombre | UUID oficial |
|---|---|
| Histórico | 3b341849-b018-439b-a154-0ff793b50da2 |
| Arqueológico | f084d441-c3a4-47a5-a858-2f1fde25daed |
| Cultural | 23da7d78-da5c-4308-b463-ebdaf36d4234 |
| Natural | da112601-b363-4956-b0f8-c649ee3f3e7c |
| Religioso | 48cbb282-98be-4efe-b7ab-27fb1222c3ce |
| Gastronomía | 2d733260-d91f-4b2f-bae5-feee4896ac5a |
| Hospedaje | 622de5c3-24ff-4f4a-8484-d6cd2babe6e8 |

## Filtros implementados y UX
- Atracciones: Histórico, Arqueológico, Cultural, Natural o Religioso. Se excluyen de esta selección general los registros también asociados con Hospedaje o Gastronomía para no presentar automáticamente hoteles o platillos como atracciones.
- Histórico, arqueología, cultura/museos, naturaleza y religión: asociación correspondiente. Museos solicita Cultural; esto no certifica que todos los resultados sean museos. La redacción se basa en la categoría real, no en una subclasificación inexistente.
- Hospedaje: solo asociaciones Hospedaje, con redacción de alojamiento.
- Gastronomía, restaurantes y comida típica: asociaciones Gastronomía. No existe un subtipo verificado que permita separar establecimientos y platillos. El prompt explica la limitación, sin confirmar restaurantes o lugares visitables por el nombre. No se promete un filtro exclusivo de restaurantes o platillos.
- General/desconocida: resultados variados, sin asignar una categoría arbitraria. «¿Qué hay cerca de mí?» conserva el Top 10 de fase 1 sin necesitar categorías.
- Varias intenciones específicas o una negación detectada: aclaración local, sin IA. Es un clasificador por expresiones conservadoras, no comprensión universal del lenguaje.

Todas las asociaciones se consideran para filtrar y se muestran en el mismo campo string category, separadas por ·. No se añaden propiedades al contrato de tarjetas. Una asociación desconocida no se transforma en categoría oficial. Ausentes, vacías o nulas no autorizan clasificaciones. Los filtros trabajan con el subconjunto recuperado, no con toda la base: estado continúa solicitando limit=15; destacados, limit=20. No se presupone paginación o filtros HTTP no documentados.

El orden es validación de UUID/pertenencia, filtro de asociaciones, distancias válidas en cercanía, deduplicación por ID, orden por distancia e ID y límite local. Ordenar antes de deduplicar conserva la distancia válida mínima de cada ID. Límites: 10 cercanos, 15 por estado, 20 destacados. Se mantienen UUID originales y hasta cinco tarjetas mencionadas. La caché de destacados almacena registros sin filtrar para evitar contaminación entre intenciones.

## Limitaciones de categorías cercanas
Cuando la respuesta no vacía carece por completo de categorías utilizables y se pide un tipo específico se devuelve categories-unavailable, con aviso amable y sin IA. Si solo algunos registros tienen categorías se consideran únicamente las asociaciones verificables; el resto se excluye sin inferencias. Esto nunca activa un bloqueo por categorías para la intención general. Una respuesta vacía o cero coincidencias informa solo sobre la consulta y los registros recibidos.

No se usa /places/:id por cada candidato. El contrato actual no permite garantizar el Top 10 por categoría en producción. Requiere asociaciones en nearby o un mecanismo masivo documentado. No se implementó ni probó un endpoint nuevo.

## Verificación
Suite completa: 99 pruebas en tres suites, incluidas las 71 de fase 1. Nuevas pruebas: intenciones, asociaciones múltiples, nulas y ausentes, mixtos, cero coincidencias, filtro previo al Top 10 con más de 100 resultados, estado, caché entre intenciones y conservación del contrato. La prueba sin categorías verifica que la búsqueda general cercana sigue funcionando y que la específica informa el límite sin IA ni N+1.
Typecheck y build aprobados. Backend y proveedores simulados; no hay nuevas pruebas reales de IA ni de Postman en fase 2. La información de pruebas manuales con Groq proviene del usuario y no constituye verificación de estos nuevos cambios.

## Corrección provisional: muestra estatal de 100
El diagnóstico posterior reprodujo Puebla con GET reales: limit=15 devolvió 15 registros y cero asociaciones Gastronomía; limit=100 devolvió 100 y diez asociaciones Gastronomía. El prefijo de quince coincidió. La frase «¿Qué comida típica puedo encontrar en Puebla?» se clasificó como dishes, asociado con Gastronomía. El recorte remoto precedía al filtro local; no era un fallo del clasificador.

Con autorización posterior se separan recuperación y candidatos finales: solicitudes estatales con intención específica usan /places?stateId=UUID&limit=100; las generales mantienen limit=15. Las respuestas específicas se acotan además a los primeros cien registros si el servidor excede el límite. Después se valida pertenencia, se filtran todas las asociaciones, se deduplica y se seleccionan como máximo quince para el prompt. Los cien registros nunca se envían completos a IA. Nearby y su Top 10 no cambian.

Este apartado sustituye la indicación anterior de limit=15 para toda consulta estatal. Cien es una muestra limitada, no un catálogo exhaustivo. Un resultado vacío solo describe los registros recibidos. La solución definitiva requiere un filtro combinado de estado/categoría antes del límite o paginación documentada con orden estable y detección del final, a cargo del backend principal. No se inventaron parámetros de paginación ni se modificó ese backend.

Regresión automatizada Puebla: primeros quince sin Gastronomía; coincidencias posteriores dentro de cien, con duplicados; verifica URL limit=100, quince candidatos únicos, contenido exacto del prompt recibido por un proveedor simulado, IDs de tarjetas y contrato. También verifica que la consulta general del mismo estado vuelve a limit=15 y que un vacío no afirma ausencia global. No hubo nuevas llamadas reales a IA.
