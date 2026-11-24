# Itinerarios turísticos sencillos — Mictlán

> **Estado vigente (rama `mictlan`).** Este documento conserva el registro histórico por fases. Las reglas actuales son las de las secciones «Etapas 1 y 2», «Etapas 3 y 4» y «Corrección de seguimientos» al final. Resumen: duración explícita de 1 a 7 días; con duración, hasta 3 destinos por día y 21 por itinerario (hasta 30 candidatos), distribuidos por el backend y con el campo `itinerary`; sin duración, hasta 5 destinos sin días; más de 7 días, aviso `itinerary-days-out-of-range`; comida bloqueada; seguimientos con o sin muletillas. Las secciones «Alcance aceptado de la primera versión» y «Mejoras futuras» describen la primera versión y quedaron superadas en lo relativo a la división por días.

Ajuste final autorizado, 2026-11-04. Un itinerario es una lista ordenada orientativa de registros reales recuperados del catálogo. No es una ruta, agenda ni garantía de que los lugares puedan visitarse en el tiempo solicitado. No se modificaron Flutter, backend principal, base de datos, Render, credenciales o README.

## Diagnóstico y diseño
Antes, «Arma mi itinerario» era una sugerencia de texto sin modo de renderizado específico. La intención se interpretaba como general y producía viñetas. No había un planificador oculto que reutilizar. Ahora itineraryContext detecta localmente el modo de presentación, independiente de las categorías existentes. Así «recorrido cultural» conserva culture y «plan para visitar lugares históricos» conserva historic. La corrección mínima de cultural(?:es)? admite el singular que faltaba en el clasificador previo.

Se reconocen itinerario/itinerarios, recorrido/recorridos y combinaciones de organizar/preparar/armar/hacer/planear con plan o visita. No se fijan nombres o UUID de estados: se utiliza el catálogo dinámico de /states. No se añaden dependencias, APIs, herramientas de modelo o endpoints nuevos.

## Estado, filtros e historial
- Estado actual explícito tiene prioridad. Si falta y hay un itinerario, se intenta resolver localmente mediante las continuaciones y ventana de doce turnos existentes. Sin estado inequívoco se devuelve aclaración 200 y places vacío, incluso si hay coordenadas; no se infiere un estado a partir de location ni se elige uno por defecto.
- Itinerario general usa las categorías de atractivos (Histórico, Arqueológico, Cultural, Natural, Religioso). Se excluyen asociaciones Hospedaje y Gastronomía, incluso registros mixtos con Cultural, salvo categoría Hospedaje explícitamente solicitada.
- Categorías explícitas filtran los candidatos antes de seleccionar IDs. «Históricos en Oaxaca» → «Arma mi itinerario» conserva tanto estado como categoría. Una petición nueva explícita de itinerario con otro estado y sin categoría comienza como atractivos generales.
- «Itinerario en Puebla» → «¿Y uno cultural?» mantiene el modo y Puebla, cambiando a Cultural. «Itinerario en Veracruz» → «¿Y en Chiapas?» mantiene modo y categoría orientativa, pero cambia estado. La categoría reciente se conserva en continuaciones reconocidas. Una nueva pregunta completa no relacionada no hereda automáticamente el modo.
- Gastronomía/restaurantes/platillos en un itinerario responden con una limitación local: no hay subtipo verificado de establecimiento visitable. No se convierten platillos en paradas. Hospedaje explícito puede enumerar opciones de alojamiento verificadas sin servicios, rutas o reservas.
- Se mantienen recuperación provisional hasta 100 para categoría estatal y máximo 15 candidatos a IA; hasta cinco destinos de la selección validada y hasta tres en fallback local (vigente sin duración; con duración rigen los límites de las etapas 3 y 4). No se rellenan cupos con datos inventados.

El historial completo sigue sin enviarse al proveedor. Solo se derivan localmente modo, categoría y territorio. Los candidatos y la pregunta actual se entregan como JSON no privilegiado bajo las mismas reglas de privacidad y redacción de fase 4. No se retiene conversación en servidor. La memoria es conservadora, no interpreta cualquier continuación y no supera doce turnos.

## Selección y presentación seguras
Los proveedores mantienen la misma interfaz y JSON interno {"placeIds":[...]}. Se validan formato, lista, cantidad, duplicados y pertenencia exacta a los candidatos. No se permite prosa libre ni IDs aportados como autoridad por el historial. Un resultado parcial/malformado/inventado se rechaza completo y usa los primeros tres candidatos seguros sin nueva IA. Un arreglo vacío válido no genera destinos. Sin candidatos de la muestra se devuelve aviso local.

El renderer cambia únicamente el modo de lista: 1., 2., 3. en el orden de los IDs validados (o el orden del catálogo en fallback). No optimiza ese orden. El número n corresponde al objeto places[n-1], con su UUID original. Las descripciones usan el mismo filtro conservador y origen shortDescription de fase 3; si faltan, son largas, sensibles o sospechosas, solo aparece el nombre. No se generan resúmenes o datos de visita.

La plantilla no añade horarios, costos, tiempos de traslado, kilómetros entre paradas, reservas o duración por destino. Incluso cuando el usuario pide un día, la duración es solo una preferencia y se advierte que no se garantiza completar las visitas. Ninguna llamada adicional se hace por destino. Los tiempos del mensaje pueden afectar la elección del modelo, pero no se convierten en una agenda o una promesa en reply.

previousRecommendationIds admite tanto viñetas anteriores como listas numeradas (hoy de uno o dos dígitos, hasta 21 elementos; originalmente hasta cinco). Esto mantiene «de esos» después de un itinerario; la lista solo estrecha candidatos actuales verificados, sin convertir el historial del cliente en un registro autenticado. Nombres duplicados siguen requiriendo aclaración. No cambia la asociación final de tarjetas por IDs.

## Ejemplo con datos simulados
Petición:

```json
{"message":"Organízame un itinerario de un día para conocer Puebla"}
```

Fixture simulado, no destinos cuya existencia se afirma en producción: Destino 0/Histórico con shortDescription «Arquitectura colonial.», Destino 1/Cultural, Destino 2/Arqueológico, Destino 3/Natural y Destino 4/Religioso. El fixture también tiene hotel, Gastronomía y Cultural+Hospedaje que se excluyen. Todos tienen stateId ficticio resuelto desde el /states simulado.

Reply del test:

```text
Itinerario sugerido para conocer Puebla:
1. Destino 0: Arquitectura colonial.
2. Destino 1
3. Destino 2
4. Destino 3
5. Destino 4
Este itinerario es orientativo. Confirma horarios y disponibilidad antes de tu visita; el orden no representa una ruta optimizada. La duración solicitada es solo una preferencia: no garantiza que puedas visitar todas las paradas en ese tiempo.
```

places conserva en ese orden los UUID ficticios 00000000-0000-4000-8000-000000000100 a 00000000-0000-4000-8000-000000000104 y sus campos originales. provider y suggestions conservan su semántica previa. No se agregó una propiedad pública itinerary.

## Flutter
Enviar cualquiera de las expresiones como message a POST /chat. El botón «Arma mi itinerario» simplemente envía ese texto, con el historial de sesión original si se quiere conservar el estado. Mostrar reply con la numeración que contiene y places como tarjetas en el mismo orden, sin crear tarjetas por nombres ni reconstruir una ruta de mapas. Sin contexto territorial se mostrará la pregunta local por estado. Para seguimientos, conservar el reply original (ahora numerado) en history como assistant; la UI puede estilizarlo sin reescribir el texto enviado al servidor. No cambian DTO, headers, autenticación o errores HTTP.

## Verificación
Suite completa: once suites, **275 pruebas aprobadas** (248 anteriores sin modificaciones más 27 del itinerario). npm run typecheck y npm run build aprobados. La suite itinerary.spec.ts cubre expresiones, estados de catálogo simulados Puebla/Oaxaca/Veracruz/Chiapas/Yucatán, herencia territorial/categoría, cambios explícitos, falta de estado con y sin location, cultura/historia, IDs válidos/inventados/repetidos, prosa inválida, descripciones ausentes, pocas paradas, cero coincidencias, exclusión hotel/comida, correspondencia lista-tarjetas, contrato y ausencia de horarios/kilómetros ficticios. Comprueba seguimiento de lista numerada y que una pregunta normal no herede el modo.

Durante la implementación no se llamó a IA o Render. Posteriormente, el usuario confirmó pruebas satisfactorias de itinerarios sencillos con Groq y el catálogo real de MXGuide. Esta validación manual se registra como reportada por el usuario; Codex no repitió las llamadas ni inspeccionó nuevas respuestas en este cierre documental. La integración Flutter real y la aceptación de riesgos de producción no quedan certificadas por esa prueba. No se hicieron commits, push, merge o despliegues.

## Límites restantes
La muestra de 100 no es exhaustiva; no hay paginación o filtro remoto por categoría verificado. No se garantiza cercanía física entre paradas, apertura, tiempos o cantidad mínima. La pertinencia de orden es orientativa. No hay soporte de gastronomía como paradas visitables sin contrato adicional; una lista de alojamientos no equivale a reservas. El reconocimiento lingüístico y la memoria son heurísticos y acotados. No se recupera toda la conversación ni se desbloquea prosa del modelo. Toda mejora de rutas, tiempos, mapas o subtipos requiere otro alcance y coordinación; no está implementada aquí.


## Alcance aceptado de la primera versión
La primera versión conserva una lista general ordenada y orientativa, sin organización específica por días. Funciona para solicitudes como «Organízame un itinerario de un día en Yucatán». Si se solicita «Organízame un itinerario de tres días en Yucatán», se genera igualmente una lista general: no se divide en Día 1, Día 2 y Día 3 ni se asignan paradas a fechas o jornadas. Yucatán es un ejemplo de solicitud; la resolución del estado sigue siendo dinámica.

La duración solicitada es orientativa y no garantiza que todos los lugares puedan visitarse dentro de ese periodo. No se calculan rutas, horarios, distancias entre paradas ni tiempos de traslado. Los lugares y UUID proceden exclusivamente de los candidatos recuperados y verificados del catálogo de MXGuide; no se inventan destinos para completar días o cantidades.

Este comportamiento fue aceptado por el usuario para cerrar el desarrollo de la primera versión. La falta de división por días es una decisión de alcance, no un error pendiente de corregir para esta versión. Se conserva el contrato público y no se cambia la implementación en este cierre documental.

## Mejoras futuras
- ~~Organización de itinerarios por días~~ — implementada en las etapas 3 y 4 (ver abajo); sigue sin implicar rutas optimizadas ni garantías de duración.
- Filtrado nativo por categoría en el backend principal, aplicado antes del límite, para superar la muestra provisional de hasta 100 registros. Requiere contrato e implementación del equipo responsable del backend.
- Enriquecimiento de /places/nearby con asociaciones verificadas de categorías para permitir filtros específicos eficientes antes del Top 10. Requiere cambios coordinados del backend principal; la consulta cercana general actual se conserva.

Estas mejoras no están implementadas ni comprometidas como correcciones de cierre. No se modificó el backend principal ni se añadieron endpoints o propiedades hipotéticas.

## Etapas 1 y 2 (detección, duración y seguimiento)

**Detección.** Además de «itinerario», «recorrido» y «arma/planea/organiza … visita/plan», se reconocen «planea mi viaje a X», «planéame N días en X», «¿qué puedo hacer N días en X?», «ruta por X», «organízame un fin de semana en X» y «quiero recorrer X durante un día». No se confunde con «¿qué clima hace en 3 días?» ni con recomendaciones normales.

**Duración.** Solo la que escribe el usuario: 1 a 7 días (cifra o palabra), «fin de semana» = 2, «un día», «día completo», «todo el día». Sin duración explícita no se supone ninguna; con más de 7 días (o «dos semanas») se responde el aviso `itinerary-days-out-of-range`, que pide elegir de 1 a 7 sin mostrar lista ni sustituir la duración. «Una semana» = 7 días. «Un día de estos» o «algún día» no son duración. La duración aparece en el título («Itinerario sugerido para conocer Puebla en 3 días:») y las paradas se reparten por día (etapa 3, abajo). No se agregan horarios, traslados, costos ni duración de visitas.

**Comida.** Se bloquea cualquier itinerario de comida («comida», «comer», «restaurantes», «antojitos», «sabores», «gastronómico»…) con `itinerary-food-unverified`, sin IA.

**Seguimiento** (memoria local, últimos 12 turnos del usuario en cadena contigua; no se envía historial a la IA):

| Mensaje tras «Itinerario de 3 días en Puebla» | Resultado |
|---|---|
| «¿Y en Oaxaca?» | Itinerario de Oaxaca, 3 días |
| «¿Y uno cultural?» | Itinerario cultural de Puebla |
| «Mejor que sean 2 días» | Itinerario de Puebla, 2 días |
| «Agrega un museo» | Itinerario de Puebla con museos (intención cultural), sin mezclar estados |
| «¿Qué más?» | Más paradas de Puebla sin repetir las ya mostradas; si no quedan, aviso `exhausted` |

Una conversación intermedia (p. ej. «gracias, ¿qué ropa llevo?») corta la cadena. Aún no se soporta quitar paradas ni itinerarios de varios estados.

## Etapas 3 y 4 (distribución por días y campo `itinerary`)

**Límites.** 1 a 7 días; hasta **3 destinos por día** y **21 por itinerario**. Objetivo = mín(días × 3, 21, candidatos disponibles). Para itinerarios con duración se toman hasta **30 candidatos** del estado (en lugar de 15); siempre del `stateId` resuelto, sin hospedaje ni gastronomía.

**Quién decide qué.** El modelo solo elige y ordena IDs entre los candidatos (recibe `maxPlaceIds`). NestJS valida la lista blanca, el máximo y los duplicados; si la selección es inválida usa un **fallback determinista** (primeros candidatos válidos en orden del catálogo) y lo registra como `code: selection-fallback` en el diagnóstico. La **distribución por días** la hace el backend (`src/places/itinerary-plan.ts`, función pura `planItineraryDays`):

- Elimina duplicados y limita a días × 3 y 21.
- Alterna categorías cuando hay variedad (preferencia; nunca descarta destinos).
- Reparte equilibrado: ⌊n/d⌋ por día y uno extra en los primeros días (10 en 4 días → 3, 3, 2, 2; 21 en 7 → 3 por día).
- Con menos destinos que días usa solo los días necesarios (1 por día), **sin días vacíos ni destinos inventados**, y el texto indica cuántos días quedan libres («Encontré 4 destinos para tus 7 días: los últimos 3 días quedan libres para que los planees tú.»).

**Presentación.** Párrafos `**Día N**` y, debajo, lista numerada con **numeración global continua**: el destino N del `reply` es `places[N-1]`. El aviso mantiene «el orden no representa una ruta optimizada». No hay horarios, duración de visitas, distancias, traslados ni costos. Si un itinerario largo superaría 3 800 caracteres, se omiten descripciones (y después tipos) para que el `reply` quepa en un turno de historial (4 000).

**Sin duración** («Arma un itinerario en Puebla») se conserva el comportamiento anterior: hasta 5 destinos, sin días y sin campo `itinerary`.

**Seguimiento.** «¿Y en Oaxaca?» redistribuye en el nuevo estado con la misma duración; «Mejor que sean 2 días» redistribuye con la nueva duración; «¿Qué más?» excluye los destinos ya mostrados (listas numeradas de uno o dos dígitos, hasta 21 elementos; los encabezados `**Día N**` se ignoran); «de esos» funciona con listas de más de 5 paradas. Siguen fuera de alcance: quitar destinos, varios estados, más de 7 días, comida y hospedaje como paradas, rutas y coordenadas.

Contrato del campo `itinerary`: ver [CONTRATO_RESPUESTAS.md](CONTRATO_RESPUESTAS.md).

## Corrección de seguimientos (muletillas y duraciones aisladas)

- Las muletillas iniciales no impiden reconocer un seguimiento: «perdón», «disculpa», «oye», «ok», «bueno», «entonces», «mejor dicho», «mmm», «ah», y «no» o «sí» **seguidos de coma** («No, mejor en Oaxaca»). Sin coma, «no quiero…» conserva su sentido de negación.
- Aplica a cambios de duración («Perdón, mejor de solo 5 días»), agregar destinos («Bueno, agrega un museo»), «¿qué más?» («Oye, ¿qué más hay?») y cambios de estado o intención («No, mejor en Oaxaca», «Oye, ¿y uno cultural?»).
- Una duración aislada («5 días», «solo 3 días», «una semana», «Ok, entonces 5 días») solo continúa el itinerario si el turno anterior del usuario pertenece a un itinerario; sin ese contexto es conversación y no consulta el catálogo.
- Secuencia validada: «Itinerario de 10 días en Puebla» → aviso 1–7 → «Perdón, mejor 5 días» → itinerario de Puebla en 5 días.

Pruebas: `test/itinerary-leadins.spec.ts`, `test/itinerary-plan.spec.ts`, `test/itinerary-stages.spec.ts`, `test/itinerary.spec.ts`.

