# Auditoría de integración del catálogo

Fecha: 2026-11-04. Rama observada: chatbot/filtro-estados. El nombre solicitado era chatbot/filtrado-estados; no se cambió automáticamente.

## Arquitectura antes de fase 1
Cliente → POST /chat → validación y guards → PlacesService → backend principal independiente → prompt, últimos 12 turnos y mensaje → Gemini/Groq con fallback o race → respuesta y hasta cinco tarjetas.

Sin ubicación se consultaba /places/featured?limit=20, con caché de diez minutos. Con ubicación, /places/nearby con radius=50 y limit=10. Ni mensaje ni historial participaban en la selección territorial. Esta era la causa principal del fallo por estado.

## Evidencia de fase 0
Consultas GET reales, sin IA, al backend configurado: /states devolvió 32 entradas con id y name; /places?stateId=UUID&limit=15 devolvió 15 registros de Chiapas con stateId coincidente. Destacados devolvió 20 registros con stateId sin state anidado. Nearby devolvió 155 registros pese a limit=10; su formato reducido incluyó id, name, shortDescription, relevanceScore y distanceKm.

El adaptador esperaba state.name y perdía el nombre territorial. HTTP fallido, timeout, JSON inválido, arreglos vacíos y formatos no reconocidos podían confluir en []. Categorías nulas podían provocar excepciones. El prompt permitía conocimiento general y atribuía orden por cercanía a cualquier petición con ubicación.

## Riesgos y alcance
Conservar independencia de servicios y contrato público. Limitar localmente candidatos y retener UUID originales. Distinguir disponibilidad técnica de resultados vacíos; no sustituir un estado por destacados. No registrar cuerpos de errores de proveedores. El README contiene referencias antiguas a Grok/xAI; esta fase no lo modifica.

Las 18 pruebas originales y typecheck pasaron en fase 0. No había cobertura del HTTP de catálogo, caché ni reconocimiento territorial. No se inspeccionaron credenciales de .env ni se modificaron backend, PostgreSQL, Flutter o Render.
