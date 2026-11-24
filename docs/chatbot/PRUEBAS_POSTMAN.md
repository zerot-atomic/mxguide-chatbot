# Pruebas Postman

## Evidencia manual recibida y comprobada en fase 0
El usuario verificó GET /states y GET /places?stateId=UUID&limit=15 contra Render. La auditoría repitió GET de estados, lugares filtrados, destacados y cercanos; los formatos y conteos están en AUDITORIA.md. Chiapas es un caso de prueba, no una condición del código.

## Fase 1: comprobaciones manuales pendientes
No se ejecutó POST /chat contra proveedores reales ni se desplegó esta implementación. Las siguientes son instrucciones de validación futura, no resultados ya obtenidos.

1. GET {{backendUrl}}/states: identificar id y name del destino elegido.
2. GET {{backendUrl}}/places?stateId={{stateId}}&limit=15: confirmar pertenencia y conservar IDs para comparar.
3. POST {{chatbotUrl}}/chat, Content-Type application/json y x-api-key si está configurada, cuerpo {"message":"¿Qué lugares de Chiapas hay en MXGuide?"}. Repetir con Puebla, Oaxaca, Quintana Roo y otros nombres del catálogo. Este paso consume IA si hay candidatos.
4. Repetir el estado con location {"lat":19.0414,"lng":-98.2063}; debe prevalecer el estado, sin afirmar orden cercano.
5. Comparar Ciudad de México, Estado de México y México. La última expresión pide precisión.
6. Probar {"message":"¿Qué hay cerca de mí?"} sin ubicación: debe solicitarla sin IA.
7. Agregar coordenadas: contrastar los diez candidatos con el ranking por distanceKm e ID de los resultados originales de nearby. Las tarjetas pueden ser menos de diez porque solo muestran nombres mencionados, hasta cinco.
8. Probar historial con un turno user que mencione un estado y mensaje actual "¿y cuáles recomiendas?"; luego cambiar explícitamente el estado.
9. Múltiples estados o negaciones deben pedir aclaración. No simular errores cambiando Render o credenciales: esas rutas están cubiertas con mocks.

Verificar siempre reply string, provider gemini|groq, places array y suggestions array. No guardar llaves, coordenadas personales o conversaciones sensibles en evidencias compartidas.

## Fase 2: validación manual pendiente
No ejecutada en esta fase. Probar históricos, arqueología, museos, naturaleza, religión, hospedaje, gastronomía, restaurantes y comida típica en un estado con asociaciones reales. Comparar IDs con /places?stateId=UUID&limit=15; confirmar que todas las asociaciones cuentan. Cultural no garantiza subtipo museo; Gastronomía no garantiza restaurante ni platillo visitable.
Comparar «¿Qué hay cerca de mí?» con ubicación (Top 10 general funcional aunque falten categorías) frente a «museos cerca de mí», «hoteles cerca de mí» y «restaurantes cerca de mí» (aviso de limitación si nearby carece de categorías). Confirmar contrato Flutter sin nuevas propiedades y sin consultas individuales de detalle. Cualquier prueba POST con candidatos confirmados puede consumir IA; las 99 automatizadas usan mocks. No cambiar Render ni backend para simular escenarios.

## Corrección Puebla: evidencia y validación pendiente
Diagnóstico previo mediante GET: Puebla limit=15 → 15 registros, cero Gastronomía; limit=100 → 100 registros, diez Gastronomía, con el mismo prefijo de quince. No hubo IA en ese diagnóstico. La regresión de la corrección usa únicamente mocks.
Pendiente tras esta corrección: probar POST /chat con «¿Qué comida típica puedo encontrar en Puebla?» y comparar candidatos con la muestra de /places?stateId={{pueblaId}}&limit=100. No ejecutar este POST con IA real como parte de los tests automatizados. Confirmar máximo 15 candidatos, IDs originales y ninguna afirmación de exhaustividad. Una consulta estatal general debe seguir solicitando limit=15. Conservar prueba general cercana Top 10. No hay nuevas pruebas manuales ejecutadas de la implementación corregida.

## Fase 3: pruebas manuales pendientes
No ejecutadas con IA real. En entorno autorizado, consultar destinos de un estado, hospedaje, gastronomía y cercanía general. Comprobar que reply enumera exactamente las tarjetas, con UUID originales, sin prosa libre de apertura, precio o servicios. Confirmar advertencia Gastronomía y ausencia de distancias en estado. Comparar ambos proveedores, fallback y race. Para nombres repetidos, verificar correspondencia por UUID, no por texto. Un modelo que omita JSON debe producir aviso seguro con hasta tres registros del contexto sin reintento. Medir frecuencia de fallback local antes de valorar la calidad conversacional; el formato público se conserva pero la redacción ahora es controlada. Pruebas adversariales de respuestas malformadas e IDs inventados se ejecutaron únicamente con mocks en la suite de 125 pruebas; no se cambió Render para simularlas.
