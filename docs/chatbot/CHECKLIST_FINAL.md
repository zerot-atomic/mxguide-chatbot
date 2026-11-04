# Checklist final — entrega de Mictlán

Fecha: 2026-11-04. Rama observada: chatbot/filtro-estados. HEAD al iniciar fase 5: e0efc48 (fase 4). Principal remota observada mediante refs locales: origin/main, también existe main local. Reconfirmar la rama de destino antes de una PR; no se hizo fetch ni se consultó el estado actual del remoto.

**Estado de entrega:** documentación y pruebas locales preparadas. Integración Flutter, despliegue y aprobación de producción pendientes. No marcar listo para producción hasta resolver o aceptar formalmente los riesgos de DESPLIEGUE_RENDER.md.

## Verificado en esta fase

- [x] Auditoría del contrato real: DTO, controlador, guards, renderer, errores, configuración y arranque.
- [x] Tests completos: 10 suites, **248 pruebas aprobadas** (234 anteriores y 14 nuevas).
- [x] Typecheck: `npm run typecheck`, aprobado.
- [x] Build: `npm run build`, aprobado.
- [x] Entorno local de ejecución observado: Node v24.18.0. El Blueprint propone 22; no se certifica esa versión con estas ejecuciones.
- [x] Diff de producción revisado: una línea cambia únicamente la presentación a toFixed(2). No cambia distancia numérica, orden, radio, candidatos o IDs.
- [x] Distancias en reply: cero, fracciones, redondeo y distancias mayores; tarjetas conservan número y objeto original.
- [x] Contrato probado por HTTP local: petición mínima, history/userName/location opcionales, respuesta con y sin tarjetas, IDs exactos y omisión de distanceKm cuando no existe.
- [x] Errores sanitizados 400/401/429/503 comprobados en nueva suite; 413/500 y otros escenarios permanecen cubiertos por seguridad previa.
- [x] Ubicación usada en nearby y excluida del proveedor como campo, según suites de compatibilidad y seguridad.
- [x] Estados dinámicos: 32 fixtures, nombres compuestos y cambios de estado; sin excepción Puebla en producción.
- [x] Categorías: asociaciones múltiples y limitaciones reales conservadas; no se afirma soporte de categorías en nearby cuando faltan.
- [x] IDs estructurados: desconocidos, duplicados y formato inválido rechazados; tarjetas desde catálogo verificado.
- [x] Historial: contexto local limitado, de esos frente a allí, prioridad del mensaje actual y sin transcripción al proveedor.
- [x] Personalización local opcional con nombre seguro; no enviado al proveedor.
- [x] Inyección básica, role spoofing, secretos ficticios, enlaces, JSON inválido y cuerpos excesivos cubiertos con mocks.
- [x] Autenticación opcional y rate limiting local probados, sin cambiar política de acceso.
- [x] Revisión de Git: cambios de fase 5 limitados al renderer, dos nuevas suites y documentación. Sin commit, push, merge ni despliegue.
- [x] .env permanece ignorado y no aparece como archivo versionado; no se leyó ni modificó. README, render.yaml, package-lock, Flutter y backend principal sin cambios.
- [x] Escaneo de archivos versionados y nuevos no ignorados contra formatos conocidos de claves Google/Groq y bloques de clave privada: sin coincidencias. No imprime valores ni incluye .env ignorado. Es una comprobación acotada, no prueba exhaustiva sobre todo el historial o formatos posibles.
- [x] Guías creadas: INTEGRACION_FLUTTER.md, DESPLIEGUE_RENDER.md y esta checklist.
- [x] Documentación Render contrastada con fuentes oficiales; configuración real del dashboard no inspeccionada.

Pruebas nuevas: distance-presentation.spec.ts (6 casos) y flutter-contract.spec.ts (8 casos). Usan backend/proveedores simulados y HTTP de loopback local; no se llamó a Groq, Gemini o Render. Se reutilizaron dependencias instaladas; no se ejecutó npm ci ni se añadieron paquetes. Jest corrió fuera del sandbox con autorización por su problema previo de permisos de caché.

## Pendiente antes de integrar o publicar

- [ ] Compilar y adaptar los ejemplos Dart con las versiones reales del equipo. No se ejecutó dart analyze ni flutter test aquí.
- [ ] Implementar en Flutter botón flotante, pantalla, loading, reintento manual y conservación de reply original en historial.
- [ ] Verificar HTTP real desde Android/iOS/web según plataformas del proyecto: URL por ambiente, UTF-8, TLS, permisos de red y ubicación opcional.
- [ ] Confirmar navegación existente por UUID y evitar rutas, enlaces o acciones inventadas.
- [ ] Probar la integración con cards vacías, permisos denegados, error de red, timeout, 400/401/413/429/503 y pulsaciones duplicadas.
- [ ] Acordar manejo de sugerencias como texto: itinerario sencillo orientativo disponible; no prometer rutas optimizadas, mapas, agenda o traslados.
- [ ] Confirmar URL HTTPS del chatbot y política x-api-key por canal seguro; ninguna key del proveedor en el cliente.
- [ ] Acordar autenticación de producción; una key estática extraíble no es identidad de usuario.
- [ ] Verificar proxy de Render y X-Forwarded-For frente a trust proxy=1; revisar NAT, múltiples instancias y cuotas compartidas.
- [ ] Aceptar presupuesto/costo de fallback/race y llamadas perdedoras sin cancelación; definir observabilidad sin PII.
- [ ] Confirmar disponibilidad, modelo y cuota de cada proveedor configurado.
- [ ] Aceptar formalmente o resolver categorías ausentes en cercanía y muestra estatal de 100 no exhaustiva.
- [ ] Aceptar ausencia de memoria persistente y límites de seguimiento; acordar retención/privacidad de sesión Flutter.
- [ ] Verificar tamaños reales frente a 2 MiB catálogo y 256 KiB proveedor, timeouts y arranque en frío según plan.
- [ ] Revisar setting de autoDeploy y rama vinculada **antes de publicar una rama remota**. Un push podría disparar despliegue; no está autorizado por esta entrega.
- [ ] Ejecutar despliegue y smoke tests solo tras autorización separada. No hay despliegue de fase 5 verificado.
- [ ] Realizar pruebas Postman de la versión desplegada y regresión real con ambos proveedores, con consumo aprobado. Las pruebas históricas de Groq reportadas no certifican el código aún no desplegado.
- [ ] Revisar rollback y último commit estable en el servicio real.
- [ ] Aprobación final del equipo Flutter/backend/operador para merge, despliegue y riesgos restantes.

## Rama, commit y PR: instrucciones futuras, no ejecutadas

Identificar rama y revisar archivos antes de cualquier acción:

```powershell
git branch --show-current
git symbolic-ref --quiet refs/remotes/origin/HEAD
git status --short
git diff --stat
git diff --check
git diff --name-only
```

Revisar también archivos nuevos (no aparecen en git diff hasta agregarlos). Inspeccionar diff en un entorno privado; no pegar .env, headers, logs de usuarios o keys en PR. No usar `git add .`. La ausencia de secretos requiere revisión humana además del escaneo. Si aparecen cambios de otros autores, separarlos sin deshacer trabajo ajeno.

Solo después de autorización explícita de **commit**, un ejemplo de staging acotado para esta fase es:

```powershell
git add -- src/chat/verified-recommendation.ts test/distance-presentation.spec.ts test/flutter-contract.spec.ts docs/chatbot/INTEGRACION_FLUTTER.md docs/chatbot/DESPLIEGUE_RENDER.md docs/chatbot/CHECKLIST_FINAL.md docs/chatbot/CAMBIOS.md
git diff --cached --stat
git diff --cached --check
# Revisar contenido completo del staging en privado antes del commit.
git commit -m "docs(chatbot): preparar integración Flutter y entrega de Mictlán"
```

La lista asume solo los archivos de esta entrega; verificarla contra status real. No se realizó ese commit en fase 5.

Solo después de autorización de **publicación**, y de confirmar con el operador que el push no provocará un deploy no autorizado:

```powershell
git push -u origin chatbot/filtro-estados
```

No ejecutar push automático ni force push. En GitHub o el gestor del repo, abrir una PR desde chatbot/filtro-estados hacia la principal confirmada (origin/main fue la observada, no una suposición de nombre). Incluir problema resuelto, resumen final, 248 pruebas/typecheck/build, guías y riesgos pendientes. No incluir claves ni conversaciones personales. Verificar el diff **completo de la rama**, que puede incluir fases anteriores, y reescribir título/descripción al alcance real.

Antes de fusionar: equipo revisa pruebas/CI, contrato con su cliente Flutter, manejo de errores/permisos, ausencia de secretos y aceptación de riesgos. Aprobar merge no significa que aquí se haya ejecutado. Verificar además autoDeploy de la rama destino antes del merge: puede desplegar al fusionar. El procedimiento de despliegue y rollback está en DESPLIEGUE_RENDER.md.

## Paquete que se comparte

Compartir enlaces de las tres guías y FASE4_SEGURIDAD.md, rama y commit revisados, resultado de tests y responsables. Completar URL real de chatbot por ambiente, política de acceso, límites y timeout acordado, ruta existente de ficha por UUID y canal de incidencias. Configuración sensible se entrega únicamente mediante el procedimiento seguro del equipo. No enviar .env, claves Gemini/Groq ni dumps de catálogo/usuarios. Mictlán queda preparado documentalmente para integrar, no certificado en Flutter ni habilitado para producción.

## Ajuste final autorizado: itinerarios sencillos
- [x] Modo de lista numerada orientativa, separado de categorías; territorio explícito/heredado y aclaración si falta.
- [x] 275 pruebas en once suites: 248 regresiones y 27 nuevas; typecheck/build aprobados.
- [x] Exclusión de hoteles/platillos en itinerario general; IDs exactos, máximos existentes y ninguna prosa libre del proveedor.
- [x] Documento ITINERARIOS_SENCILLOS.md y guía Flutter actualizados. No hay mapa, agenda, ruta optimizada o garantía de duración.
- [x] Prueba manual de itinerarios con Groq y catálogo real confirmada posteriormente por el usuario; registrada sin nuevas llamadas de Codex.
- [ ] Validación de itinerarios desde Flutter real; sigue pendiente y no se deduce de Postman.

Este apartado sustituye el pendiente de explicar «Arma mi itinerario» como sugerencia sin plantilla específica: ahora envía una petición de lista orientativa. La UI Flutter sigue pendiente y no se modificó. Antes de un futuro commit/push autorizado revisar también itinerary.ts, itinerary.spec.ts, places.service.ts, tourism-intent.ts, followup-context.ts, chat.service.ts, verified-recommendation.ts e ITINERARIOS_SENCILLOS.md y las actualizaciones documentales; la lista de staging de fase 5 es histórica y no cubre por sí sola este ajuste. No ejecutar commits, push o despliegues con esta checklist sin autorización separada.


## Cierre de desarrollo de la primera versión: alcance aceptado
- [x] Se documenta soporte de solicitudes como «Organízame un itinerario de un día en Yucatán».
- [x] Solicitudes de tres o más días mantienen una lista general, sin Día 1/Día 2/Día 3; comportamiento aceptado para esta versión.
- [x] Duración orientativa, sin garantía de completar todos los destinos dentro del periodo solicitado.
- [x] No se calculan rutas, horarios, distancias entre paradas ni tiempos de traslado.
- [x] Lugares y UUID exclusivamente del catálogo verificado de MXGuide.
- [x] División por días registrada como mejora futura, no como error pendiente de cierre.

Mejoras futuras sin implementar: organización por días; filtrado nativo por categoría y enriquecimiento de /places/nearby, dependientes del responsable del backend principal. Esta aceptación de alcance funcional no resuelve ni acepta automáticamente los riesgos de despliegue, autenticación, cuotas o integración Flutter que siguen marcados como pendientes en esta checklist.

Cierre documental: solo se actualizan cuatro documentos de docs/chatbot/. No se modifican código o pruebas ni se repiten tests, typecheck o build; los resultados anteriores de 275 pruebas y compilación se mantienen como evidencia histórica, no como ejecuciones nuevas. No hubo llamadas reales a IA, commits, push, merge o despliegues.
