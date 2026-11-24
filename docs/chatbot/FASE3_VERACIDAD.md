# Fase 3: veracidad y consistencia

## Diagnóstico e inspección
Rama chatbot/filtro-estados. Se observaron commits previos de fases 1 y 2; esta fase no crea commits. La inspección incluyó ChatService, prompt, PlacesService, clientes Gemini/Groq, estrategias y 101 pruebas anteriores.

Antes, el texto del proveedor se publicaba íntegro en reply. Las tarjetas se asociaban por nombres normalizados. Incluso sin tarjeta, un texto podía afirmar que Atlantis pertenecía a MXGuide, inventar apertura o recomendar un destino ajeno. Nombres duplicados o contenidos entre sí tampoco constituían una identidad fiable.

PlacesService ya valida UUID y pertenencia por stateId, considera todas las categorías, deduplica y limita candidatos. Se conservó sin cambios: recuperación estatal específica de hasta 100, general de 15; máximo 15 estatales enviados a IA; Top 10 cercano por distancia e ID. Los contratos insuficientes de categorías cercanas y restaurantes/platillos siguen vigentes.

## Solución
El modelo recibe únicamente los candidatos seleccionados con sus IDs. Su salida interna esperada es texto JSON estricto con una sola propiedad: {"placeIds":["UUID permitido"]}. No se exige ni se presupone soporte nativo de JSON Schema. Los clientes actuales ya transportan texto en Gemini generateContent y Groq chat/completions; permanecen intactos.

El validador exige objeto, propiedad única, arreglo de strings con máximo cinco IDs distintos y pertenencia exacta a la whitelist de candidatos. No normaliza ni crea UUID. Rechaza IDs desconocidos, repetidos, propiedades adicionales (incluido reply), markdown envolvente, tipos incorrectos, JSON malformado y salidas de más de 16000 caracteres. Los objetos públicos son los originales del resumen validado, nunca datos creados por el modelo.

La selección por nombre dejó de usarse en el flujo de chat. mentionedPlaces permanece como utilidad heredada cubierta por sus pruebas, pero no decide ninguna tarjeta pública. Nombres idénticos o similares no modifican la correspondencia por ID.

## Política de respuesta
- JSON válido: se seleccionan los objetos originales por ID, en el orden elegido, hasta cinco. El servidor construye tanto reply como places a partir de esos mismos objetos.
- Arreglo vacío válido: aviso sin tarjetas, sin afirmar ausencia global ni añadir recomendaciones no solicitadas por la selección.
- Salida parcialmente inválida: se rechaza completa, sin intentar conservar fragmentos ni texto libre. Se ofrecen los primeros tres candidatos verificados del contexto, con un aviso de selección no validada.
- Salida completamente inválida o texto libre: misma respuesta segura. No se intenta reconocer entidades en prosa ni detectar alucinaciones con listas de palabras.
- Sin candidatos utilizables: aviso seguro sin tarjetas. Fallos de catálogo mantienen los avisos locales existentes.

El texto público solo enumera nombres, categorías y estado disponibles. Distancias se muestran únicamente en contexto cercano y si son numéricas, finitas y no negativas. Se indica que la selección no es exhaustiva y se pide confirmar horarios, precios y servicios, sin afirmar disponibilidad. Gastronomía mantiene el aviso de que no distingue restaurantes de platillos ni confirma lugares visitables. No se publican descripciones, texto del usuario, historial ni prosa del modelo. Los campos textuales impresos se entrecomillan como datos y se escapan caracteres de formato.

Esta decisión restringe deliberadamente la redacción: en el flujo con candidatos, reply es una enumeración controlada; no reproduce itinerarios creativos, explicaciones culturales o instrucciones de traslado del modelo. La forma del contrato Flutter no cambia, pero sí esta característica de la redacción. No se afirma validación semántica universal del texto generado; se evita publicarlo.

## Datos no confiables y seguridad
Mensaje, historial, nombre, catálogo y respuesta se consideran datos no confiables. El prompt lo explicita. Las descripciones se omiten del prompt de selección y de reply para reducir inyección y afirmaciones no verificadas. Los campos de catálogo no otorgan autoridad para cambiar IDs, estado o intención. La validación local es la barrera efectiva incluso si el modelo ignora las instrucciones.

Se confía en la autenticidad del backend como fuente de registros, no en que todos sus textos sean verdaderos o estén actualizados. Un nombre malicioso o una categoría errónea del backend siguen siendo datos que el responsable del catálogo debe corregir. La validación garantiza correspondencia con registros recuperados, no calidad editorial, existencia física, publicación actual o precisión geográfica absoluta.

## Compatibilidad y llamadas
POST /chat, DTO, reply/provider/places/suggestions y las tarjetas conservan tipos. No se exponen campos estructurados nuevos. provider sigue identificando el proveedor seleccionado/ganador conforme a fases previas, aunque el texto final sea renderizado por el servidor.

fallback sigue cambiando de proveedor solo ante errores de generate; race sigue escogiendo la primera promesa resuelta. Validación estructural ocurre después de la estrategia: una salida inválida usa respuesta local, no genera otra llamada ni espera a otro ganador. Si todos los proveedores fallan se conserva 503. La llamada perdedora de race no se cancela, como antes. No hay cambios en endpoints, modelos, SDKs, credenciales ni parámetros de proveedores.

## Pruebas ejecutadas
- npm test -- --runInBand --no-cache: cuatro suites, 125 pruebas aprobadas.
- npm run typecheck: aprobado.
- npm run build: aprobado.

Las pruebas existentes se conservaron y se ajustaron fixtures de selección para JSON. El test de race verifica el proveedor ganador en vez de exigir publicación de su prosa; el test HTTP sigue verificando el contrato sin exigir el antiguo saludo libre. La suite nueva cubre IDs exactos, inventados y repetidos, salidas malformadas/parciales, propiedades extra con afirmaciones falsas, nombres repetidos y contenidos, datos incompletos, ausencia de categorías, vacíos válidos, filtrado previo de estado/categoría y ausencia de reintentos por formato. Pruebas de clientes reales con fetch simulado verifican extracción de JSON como texto para Gemini y Groq. Top 10 de 155 resultados, regresión Puebla, límites y contratos previos siguen pasando. No se consumieron llamadas reales a IA ni se consultó el backend real durante esta fase.

## Pendientes manuales y límites
Validar en Postman y entorno autorizado que ambos modelos producen el JSON solicitado con suficiente frecuencia. Si no, la respuesta pública seguirá siendo segura pero usará más a menudo el fallback local. No se certifica fiabilidad de formato en producción con mocks. Probar nombres similares, solicitudes de servicios y un historial que sugiera destinos ajenos; comparar IDs con el catálogo real y verificar que el texto no anuncia apertura, precios ni destinos inventados. Estas pruebas manuales están pendientes, no se realizaron en esta fase.

El aumento provisional a 100 no es exhaustivo; faltan filtros remotos/paginación documentada. Nearby sin categorías no permite filtros específicos; general cercano sigue funcionando. Gastronomía y Cultural no certifican subtipos restaurante/platillo/museo. No se implementa fase 4.

## Refinamiento de presentación de fase 3
El usuario reportó pruebas reales exitosas con Groq para historia, hospedaje y gastronomía de Puebla. Este reporte se atribuye al usuario; no se repitieron llamadas reales durante el refinamiento.

Se modificó únicamente la presentación en verified-recommendation.ts: introductions según atractivos, historia, arqueología, cultura, naturaleza, religión, alojamiento y gastronomía (con variantes para comida típica y búsqueda de restaurantes). Se eliminan frases como «registros recuperados», «categoría del catálogo» y «estado» repetidas por línea. El destino se presenta una sola vez en el encabezado. En exploración general se utilizan etiquetas breves como cultura o alojamiento para distinguir resultados variados sin inventar subtipos.

La validación estructural de IDs, los límites y la selección permanecen intactos. La misma lista de objetos originales genera una línea por recomendación y las tarjetas; no se vuelve a asociar por nombres. Ni el contenido libre del proveedor ni sus afirmaciones se publican. El fallback conserva su selección segura de hasta tres candidatos y ahora usa también la plantilla de intención. El JSON vacío válido conserva su aviso sin tarjetas.

### Descripciones del catálogo
Esta sección sustituye la exclusión total de descripciones en reply indicada antes: se admite una copia literal breve de description, cuyo origen en PlacesService es shortDescription. No se incorporan fuentes nuevas, no se consulta longDescription y no se sintetiza texto mediante IA. Sin descripción utilizable se muestra solo el nombre; no se rellena con información inventada.

Se omite toda la descripción si supera 160 caracteres, contiene cifras, enlaces, marcas de formato, saltos de línea o términos relativos a instrucciones, disponibilidad, horarios, precios, entradas, reservas, servicios y otras afirmaciones sensibles contempladas en el filtro. No se recorta para evitar cambiar el sentido. Los valores visibles se escapan para que los caracteres de formato no se interpreten como parte de la plantilla. Los objetos de tarjeta no se modifican.

Este filtro de exclusión es conservador y heurístico: no certifica la verdad editorial de cada descripción ni detecta todas las paráfrasis posibles de instrucciones o datos sensibles. La procedencia del catálogo es necesaria para incluir texto, pero no equivale a una auditoría semántica. Se omiten descripciones dudosas detectadas; puede omitirse texto válido. El responsable del catálogo sigue siendo la fuente de verdad. El renderizador no añade horarios, precios, servicios ni disponibilidad de su propia autoría.

La distancia solo se presenta en cercanía cuando es numérica, finita y no negativa. Las consultas estatales no adquieren afirmaciones de proximidad. Gastronomía mantiene una advertencia explícita sobre platillos y establecimientos, sin afirmar que todos sean restaurantes o lugares visitables. El cierre «Son algunas opciones para empezar» conserva la condición de selección no exhaustiva y pide confirmar horarios, precios y servicios.

### Verificación del refinamiento
npm test -- --runInBand --no-cache: cinco suites, 153 pruebas aprobadas. npm run typecheck y npm run build: aprobados. La suite natural-rendering.spec.ts cubre todas las plantillas, descripción procedente de shortDescription, ausencia de descripción, destino mencionado una vez, una línea por tarjeta, advertencias gastronómicas, distancia válida, tipos generales y omisión de contenido sensible/instrucciones. verified-recommendation.spec.ts solo ajusta una expectativa de redacción para datos sin categoría; conserva las pruebas de validación. Las regresiones de fases 1, 2 y 3 siguen pasando.

Pendiente en Postman: valorar tono con consultas históricas, hospedaje y gastronomía de Puebla y confirmar que las recomendaciones y UUID siguen coincidiendo con las tarjetas. Las nuevas plantillas no necesitan cambios de Flutter. No se modificaron clientes Gemini/Groq, prompt, orquestación, recuperación de lugares o estrategias en este refinamiento. Sin dependencias nuevas, llamadas reales a IA, commits, push ni despliegues.
