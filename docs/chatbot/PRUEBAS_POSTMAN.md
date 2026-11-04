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
