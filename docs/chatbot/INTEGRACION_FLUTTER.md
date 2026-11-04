# Integración Flutter — Mictlán

Guía de entrega, 2026-11-04. Contrato inspeccionado en este repositorio. Los JSON, UUID y nombres de ejemplos son ficticios; no prueban que esos destinos existan. No se ha implementado ni validado una interfaz Flutter en esta fase. Las pruebas Postman con Groq fueron reportadas por el usuario; no sustituyen una prueba móvil/web.

## Arquitectura y alcance

Mictlán es una API NestJS independiente del backend principal. Flutter puede abrir una conversación desde un botón flotante; el equipo de la app debe construir ese botón y la pantalla. No se añade UI en este repositorio.

```text
Flutter (botón → conversación)
  └─ POST {CHATBOT_URL}/chat → Mictlán/NestJS
                               ├─ GET /states, /places, /places/nearby, /places/featured
                               │     → backend principal MXGuide → su propia base de datos
                               └─ candidatos filtrados → Gemini/Groq → IDs internos
                                      → validación y texto local → reply + tarjetas + sugerencias
```

Flutter se conecta al chatbot, no a los endpoints privados de IA. El backend principal sigue separado; el chatbot no necesita DATABASE_URL, JWT del backend, acceso directo a PostgreSQL ni permisos para modificar lugares.

## URL y headers

Host local del desarrollador: `http://localhost:3000`. Producción: URL HTTPS del **chatbot**, confirmada por el responsable del servicio; no se conoce ni se inventa aquí su hostname real. `https://chatbot.example.invalid` solo es marcador ficticio, no un servicio operativo. La URL del backend del catálogo no es la URL del chatbot.

Configurar una base sin ruta `/chat`, query o fragmento, por ambiente de Flutter; por ejemplo `String.fromEnvironment('CHATBOT_URL')`. En un emulador o dispositivo, localhost suele ser el propio dispositivo: configurar la dirección accesible del host según la plataforma/red y sus permisos. No desactivar TLS ni publicar HTTP para producción. No se alteraron manifests, entitlements ni políticas de red de Flutter.

| Header | Uso |
|---|---|
| `Content-Type: application/json; charset=utf-8` | Enviar siempre JSON con codificación UTF-8 |
| `Accept: application/json` | Recomendado |
| `x-api-key` | Obligatorio solo cuando el servidor tiene CHAT_API_KEY no vacía; igualdad exacta |

No hay autenticación JWT por usuario implementada en `/chat`. Sin CHAT_API_KEY el endpoint permite acceso público bajo el límite por IP. No enviar Authorization a Gemini/Groq desde Flutter. La key compartida del chatbot también es extraíble de un APK/AAB o bundle web, incluso usando dart-define u ofuscación: no proporciona identidad ni debe tratarse como secreto seguro del cliente. Acordar su distribución para la integración actual y una autenticación real antes de producción, sin cambiar el contrato unilateralmente. Las claves privadas de proveedores viven exclusivamente en NestJS.

## Entrada exacta

`POST /chat` no tiene prefijo `/api` en el código actual. No hay streaming, sessionId, conversationId ni tool calls públicos.

| Campo | Tipo y validación |
|---|---|
| message | String obligatorio, 1–1000 caracteres y al menos un carácter no blanco |
| history | Opcional, array hasta 20 turnos; cada turno tiene solo role y content |
| history[].role | Exactamente `user` o `assistant`; no se admiten system/developer/admin |
| history[].content | String hasta 4000 caracteres; DTO no exige longitud mínima |
| location | Objeto opcional; lat y lng obligatorios cuando se envía |
| location.lat | Number finito entre -90 y 90; no string |
| location.lng | Number finito entre -180 y 180; no string |
| userName | String opcional hasta 60 caracteres |

Campos extra se rechazan con 400, incluso en objetos anidados. Tamaño JSON total máximo 64 KiB: veinte turnos de 4000 caracteres no necesariamente caben. Medir bytes UTF-8 además de límites individuales. Omitir campos opcionales ausentes en vez de mandar formas incompatibles. El validador opcional actual también omite validación ante null; no usar null como sustituto de un contrato definido.

Petición mínima:

```json
{"message":"¿Qué lugares hay en Puebla?"}
```

Petición normal completa, sin ubicación:

```json
{
  "message": "¿Qué lugares históricos hay en Puebla?",
  "history": [
    {"role":"user","content":"Me interesa Puebla"},
    {"role":"assistant","content":"¿Qué te gustaría conocer?"}
  ],
  "userName":"Ana"
}
```

Petición con ubicación ya autorizada por el usuario:

```json
{
  "message":"¿Qué hay cerca de mí?",
  "history":[],
  "location":{"lat":19.0414,"lng":-98.2063},
  "userName":"Ana"
}
```

La ubicación se usa en NestJS para consultar nearby, no se envía como campo al proveedor. Un estado explícito prevalece sobre la ubicación. Pedir cercanía sin coordenadas produce un aviso local 200 que solicita ubicación; no hace falta enviar coordenadas en cada consulta estatal. Si se deniega permiso, permitir escribir un estado y continuar.

## Respuesta de chat: HTTP 200

| Campo | Tipo y significado |
|---|---|
| reply | String de presentación generado por NestJS, no prosa libre del modelo |
| provider | String `gemini` o `groq`; ver semántica limitada más abajo |
| places | Array de cero a cinco tarjetas seleccionadas; fallback seguro puede mostrar hasta tres |
| suggestions | Array de strings; son consultas sugeridas, no acciones ejecutables |
| places[].id | String UUID original del catálogo; no modificar su valor o mayúsculas |
| places[].name | String, hasta 120 caracteres tras adaptación |
| places[].state | String; puede ser vacío si no se informó o se omitió por seguridad |
| places[].category | String; puede ser vacío o contener varias categorías separadas por ` · ` |
| places[].description | String derivado de shortDescription, hasta 240 caracteres; puede ser vacío |
| places[].distanceKm | Number opcional; solo si el backend informó número finito no negativo |

`distanceKm` mantiene precisión original en la tarjeta, y puede estar ausente, no cero. reply presenta dos decimales en cercanía (0.40195408529000004 → 0.40 km). No recalcular, ordenar de nuevo ni cambiar IDs por el texto visible. Un valor 0 es una distancia válida. Las tarjetas no incluyen coordenadas, imágenes, enlaces externos ni endpoints de navegación.

Ejemplo ficticio sin ubicación, compatible con la plantilla y el fixture de contrato:

```json
{
  "reply":"¡Hola, Ana! Para acercarte a la historia local, aquí tienes algunas opciones en Puebla:\n- Centro Histórico de ejemplo: Conjunto de arquitectura colonial.\nSon algunas opciones para empezar. Confirma horarios, precios y servicios antes de planear una visita.",
  "provider":"groq",
  "places":[{
    "id":"00000000-0000-4000-8000-000000000101",
    "name":"Centro Histórico de ejemplo",
    "state":"Puebla",
    "category":"Histórico",
    "description":"Conjunto de arquitectura colonial."
  }],
  "suggestions":["¿Qué hay cerca de mí?","Arma mi itinerario","Comida típica de la zona","Cómo llegar"]
}
```

Ejemplo de tarjeta cercana ficticia (en la misma propiedad places):

```json
{
  "id":"00000000-0000-4000-8000-000000000101",
  "name":"Parque cercano de ejemplo",
  "state":"",
  "category":"",
  "description":"",
  "distanceKm":0.40195408529000004
}
```

Respuesta local completa sin tarjetas, si solo Groq está configurado:

```json
{
  "reply":"Comparte tu ubicación para buscar lugares cerca de ti, o dime qué estado quieres visitar.",
  "provider":"groq",
  "places":[],
  "suggestions":["¿Qué hay cerca de mí?","Arma mi itinerario","Comida típica de la zona","Cómo llegar"]
}
```

**provider no es prueba de consumo.** Para respuesta de modelo es el proveedor ganador de generate; si su JSON es inválido, NestJS puede usar texto local y conservar ese ganador. En avisos sin IA indica el primer proveedor activo según prioridad configurada. Puede decir gemini sin haber llamado a Gemini. No mostrarlo como garantía de disponibilidad, identidad del asistente o información de facturación. No existe valor `local` ni flag público de consumo.

Un array vacío no implica fallo: puede ser aclaración, ubicación faltante, cero coincidencias de una muestra, formato inválido sin selección o catálogo temporalmente indisponible. La UI debe mostrar reply y continuar la conversación. No ocultar el aviso por no tener tarjetas. El servidor no garantiza número mínimo de tarjetas.

## Errores HTTP reales

Los errores no tienen el contrato de chat: contienen `statusCode` numérico y `message` string, sin stack ni detalles remotos.

| HTTP | message actual | Acción UI |
|---|---|---|
| 400 | Solicitud inválida. | Corregir campos/tipos/límites o JSON; no reintentar idéntico |
| 401 | API key inválida | Revisar acceso/configuración; no pedir la key del proveedor al usuario |
| 413 | La solicitud supera el tamaño permitido. | Reducir historial/tamaño antes de reenviar |
| 429 | Demasiadas solicitudes. Intenta de nuevo en un momento. | Frenar envíos y ofrecer reintento manual después; respetar Retry-After si existe |
| 503 | El asistente no está disponible en este momento. | Avisar indisponibilidad y permitir reintento manual |
| 500 | No se pudo procesar la solicitud. | Aviso genérico; sin publicar cuerpos arbitrarios |
| 404 | No se pudo procesar la solicitud. | Revisar URL/ruta/método; no usar /api/chat |

```json
{"statusCode":400,"message":"Solicitud inválida."}
```

No todos los fallos de catálogo son 503: el servicio normalmente responde 200 con aviso local y places vacío. 503 se usa por ausencia/fallo de proveedores. Un proxy puede devolver HTML u otro error: no asumir JSON siempre ni mostrar HTML/stack al usuario. `/health` es público y solo reporta proceso, configuración de estrategia y presencia de claves; no verifica cuota, credenciales válidas ni catálogo accesible.

## Ejemplo Dart sugerido, no código instalado ni validado en Flutter

Referencia de transporte: [Flutter: enviar datos HTTP](https://docs.flutter.dev/cookbook/networking/send-data). El siguiente ejemplo ilustra el contrato, no implementa la UI ni añade dependencias a este repositorio. Adaptar `package:http` a las dependencias existentes del equipo y validar con su versión de Dart/Flutter.

```dart
import 'dart:async';
import 'dart:convert';
import 'package:http/http.dart' as http;

class ChatTurn {
  final String role, content;
  const ChatTurn(this.role, this.content);
  Map<String, dynamic> toJson() => {'role': role, 'content': content};
}

class PlaceCard {
  final String id, name, state, category, description;
  final double? distanceKm;
  const PlaceCard(this.id, this.name, this.state, this.category,
      this.description, this.distanceKm);
  factory PlaceCard.fromJson(Map<String, dynamic> json) => PlaceCard(
    json['id'] as String, json['name'] as String,
    json['state'] as String, json['category'] as String,
    json['description'] as String,
    (json['distanceKm'] as num?)?.toDouble(),
  );
}

class ChatResult {
  final String reply, provider;
  final List<PlaceCard> places;
  final List<String> suggestions;
  const ChatResult(this.reply, this.provider, this.places, this.suggestions);
  factory ChatResult.fromJson(Map<String, dynamic> json) {
    final provider = json['provider'] as String;
    if (!{'gemini', 'groq'}.contains(provider)) {
      throw const FormatException('Proveedor no reconocido');
    }
    return ChatResult(json['reply'] as String, provider,
      (json['places'] as List).map((p) =>
        PlaceCard.fromJson(p as Map<String, dynamic>)).toList(),
      (json['suggestions'] as List).cast<String>());
  }
}

class ChatApiException implements Exception {
  final int status;
  const ChatApiException(this.status); // No guardar headers o cuerpo remoto.
}

class MictlanClient {
  final http.Client client;
  final Uri base;
  final String? sharedChatKey; // Extraíble del cliente; no secreto seguro.
  final Duration timeout;
  bool _sending = false;
  MictlanClient(this.client, this.base, {
    this.sharedChatKey, this.timeout = const Duration(seconds: 100),
  });

  Future<ChatResult> send(String message, {
    List<ChatTurn> history = const [], String? userName,
    double? lat, double? lng,
  }) async {
    if (_sending) throw StateError('Ya hay una solicitud pendiente');
    if (message.trim().isEmpty || message.runes.length > 1000) {
      throw ArgumentError('Mensaje vacío o demasiado largo');
    }
    if ((lat == null) != (lng == null)) {
      throw ArgumentError('Enviar ambas coordenadas u omitirlas');
    }
    if (lat != null) {
      final longitude = lng!;
      if (!lat.isFinite || lat < -90 || lat > 90 ||
          !longitude.isFinite || longitude < -180 || longitude > 180) {
        throw ArgumentError('Coordenadas inválidas');
      }
    }
    if (userName != null && userName.runes.length > 60) {
      throw ArgumentError('Nombre demasiado largo');
    }
    // Ventana acotada; la UI debe conservar intercambios completos.
    final recent = history.skip(history.length > 12 ? history.length - 12 : 0)
        .toList();
    for (final turn in recent) {
      if (!{'user', 'assistant'}.contains(turn.role) ||
          turn.content.runes.length > 4000) {
        throw ArgumentError('Historial inválido');
      }
    }
    final body = <String, dynamic>{
      'message': message,
      if (userName != null) 'userName': userName,
      if (lat != null) 'location': {'lat': lat, 'lng': lng},
      'history': recent.map((turn) => turn.toJson()).toList(),
    };
    final encoded = jsonEncode(body);
    if (utf8.encode(encoded).length > 64 * 1024) {
      throw ArgumentError('Reducir historial antes de enviar');
    }
    _sending = true;
    try {
      final response = await client.post(base.resolve('/chat'), headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Accept': 'application/json',
        if (sharedChatKey != null && sharedChatKey!.isNotEmpty)
          'x-api-key': sharedChatKey!,
      }, body: encoded).timeout(timeout);
      if (response.statusCode != 200) {
        throw ChatApiException(response.statusCode);
      }
      return ChatResult.fromJson(
        jsonDecode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>);
    } finally {
      _sending = false;
    }
  }
}

// Ejemplo: rechazar configuración vacía antes de abrir la conversación.
const chatbotUrl = String.fromEnvironment('CHATBOT_URL');
// final api = MictlanClient(http.Client(), Uri.parse(chatbotUrl));
// final result = await api.send('¿Qué lugares hay en Puebla?');
// Cerrar api.client al desechar la sesión, según el ciclo de vida de la app.
```

Capturar TimeoutException, ChatApiException, fallos de red y FormatException/TypeError; presentar mensajes amigables. El timeout de 100 s es una decisión ilustrativa de cliente, no SLA del servicio. Por defecto dos consultas de catálogo de 15 s y dos proveedores de 25 s pueden sumar hasta unos 80 s más sobrecarga; con variables distintas o arranque en frío puede tardar más. El servidor no impone un timeout global. Future.timeout deja de esperar, pero no garantiza cancelar el trabajo del servidor ni la facturación. Tras un timeout no hacer reintentos automáticos ciegos.

## Pantalla conversacional y sesión

1. Botón flotante abre una pantalla/hoja de conversación. Su implementación y diseño corresponden a Flutter.
2. Al enviar, deshabilitar botón y sugerencias, mostrar loading y conservar un único envío en vuelo por sesión. No lanzar POST de nuevo desde cada rebuild. Evitar dos instancias del cliente para una misma conversación.
3. Tras 200, mostrar reply como texto; representar cada entrada de places exactamente una vez. No derivar tarjetas por coincidencias en reply ni inventar fichas para nombres mencionados.
4. Navegar por `place.id` a la ficha existente **si la app ya dispone de ruta/servicio para ello**; no se ha inspeccionado la navegación Flutter y no se inventa una ruta Dart. No usar textos o URLs del modelo como destinos.
5. Añadir message como user y **reply original sin reescribir** como assistant al historial de la sesión. La UI puede estilizarlo, pero debe conservar el string original para futuros envíos. No guardar solo nombres de tarjetas ni el JSON interno del modelo. No añadir errores HTTP como turnos assistant.
6. Conservar intercambios recientes completos dentro de los límites; eliminar los más antiguos si hace falta. Si una respuesta no cabe en 4000 caracteres, no truncarla silenciosamente para «de esos»: iniciar una nueva consulta explícita por estado o indicar pérdida de contexto. Sin idempotency key en servidor, un POST duplicado puede duplicar consumo. Un reintento manual debe reemplazar el intento pendiente en UI, no duplicar turnos.
7. Las sugerencias son texto para una nueva consulta. «Arma mi itinerario» solicita ahora una lista numerada orientativa con destinos verificados; no ejecuta un planificador de rutas, horarios, mapas o reservas. «Cómo llegar» sigue siendo una consulta de texto sin navegación específica implementada. No prometer esas funciones. Los avisos locales también pueden traer sugerencias.
8. Solo solicitar permiso de ubicación al usuario cuando corresponda; no obtenerla en segundo plano ni volverla requisito para consultas por estado. Pedir userName es opcional. No deducir ubicación del estado consultado.

NestJS no persiste conversaciones ni reconoce identidad por una sesión. Usa hasta doce turnos para resolver continuaciones inequívocas; «allí» puede conservar estado y «de esos» restringir lugares previos verificados contra la muestra actual. Los nombres duplicados, formatos antiguos, una cadena fuera de ventana o lugares fuera de la muestra pueden requerir aclaración. El historial enviado por el cliente no es prueba autenticada de lo que dijo el servidor.

## Privacidad, límites y soporte real

NestJS no manda history, userName ni location al proveedor. Sí manda pregunta actual redactada parcialmente, intención y candidatos. No anonimiza toda PII escrita en message; pedir al usuario que no introduzca claves, datos personales sensibles o información de terceros. Sin almacenamiento persistente en la app por defecto; cualquier persistencia/analítica necesita decisión de privacidad. No registrar request bodies, nombres, ubicación, headers o claves en consola, crash reports o capturas compartidas.

Estados se resuelven desde /states; no hay excepción Puebla. General estatal recupera 15; categoría estatal hasta 100, seleccionando como máximo 15 para IA. Cercanía conserva diez candidatos por distancia entre los recibidos, no necesariamente toda la base. nearby no aporta categorías verificadas en el contrato observado: una búsqueda específica cercana puede responder con limitación; general cercano continúa funcionando. Gastronomía no certifica restaurante/platillo y Cultural no garantiza museo. No hay búsquedas exhaustivas, memoria persistente ni garantía de horarios/precios/apertura. Ver [FASE4_SEGURIDAD.md](FASE4_SEGURIDAD.md).

## Entrega al equipo

Compartir esta guía, [DESPLIEGUE_RENDER.md](DESPLIEGUE_RENDER.md), [CHECKLIST_FINAL.md](CHECKLIST_FINAL.md), commit aprobado y URL de chatbot confirmada fuera de ejemplos. Informar política de acceso por canal seguro, ambientes, timeout elegido, riesgos aceptados y responsable de incidencias. No compartir .env ni claves de IA. El procedimiento de rama/PR y las validaciones pendientes están en la checklist. Esta documentación prepara la integración; no la declara validada desde Flutter.


## Ajuste final: itinerarios sencillos
Enviar {"message":"Organízame un itinerario de un día para conocer Puebla"} o el texto de la sugerencia «Arma mi itinerario». El estado se resuelve dinámicamente; Puebla es solo ejemplo. Sin estado ni referencia territorial inequívoca en history, el servidor pide qué estado desea conocer, sin inventar destinos o asumir que location define un estado.

Para «¿Qué lugares históricos hay en Oaxaca?» → «Arma mi itinerario», reenviar ambos turnos de la primera respuesta (user y reply original assistant) junto al nuevo message. Se conservan Oaxaca y la categoría. También funcionan «Itinerario en Puebla» → «¿Y uno cultural?» y «Itinerario en Veracruz» → «¿Y en Chiapas?». No enviar el JSON de selección interno; history sigue usándose solo localmente.

reply contiene una lista numerada y una advertencia orientativa. Cada número coincide con el objeto de places en esa posición. Mostrar texto y tarjetas; no dibujar una ruta ni generar un mapa o agenda a partir del orden. Conservar el reply original numerado para «de esos»; no se introducen campos públicos nuevos. Se mantienen máximos de cinco tarjetas, fallback seguro y avisos 200 locales.

La duración de un día es solo preferencia, no promesa de que todas las visitas quepan. No hay horas asignadas, costos, traslados, reservas o distancias entre paradas. Gastronomía puede requerir aclaración porque no se distinguen restaurantes de platillos; los itinerarios generales excluyen hoteles y comida. Detalles y ejemplo simulado en [ITINERARIOS_SENCILLOS.md](ITINERARIOS_SENCILLOS.md). Este apartado actualiza el soporte de la sugerencia respecto de la primera entrega de fase 5; no certifica integración Flutter real.


## Primera versión: duración y presentación del itinerario
El usuario confirmó pruebas satisfactorias con Groq y el catálogo real de MXGuide. La validación se registra como reportada por el usuario, sin nuevas llamadas desde Codex; no equivale a una validación de la UI Flutter.

«Organízame un itinerario de un día en Yucatán» solicita una lista ordenada orientativa. «Organízame un itinerario de tres días en Yucatán» también devuelve una lista general, sin dividirla en Día 1, Día 2 o Día 3. Flutter debe mostrar reply tal como llega y las tarjetas de places, sin inventar agrupaciones por días, horarios o rutas. No hay nuevos campos de duración o jornadas en el contrato.

La duración es una preferencia y no garantiza que todas las visitas quepan en ese periodo. No se calculan rutas, horarios, distancias entre paradas ni tiempos de traslado. Nombres y UUID siguen procediendo exclusivamente del catálogo verificado de MXGuide. Este alcance se acepta para la primera versión: organizar por días es una mejora futura, no un defecto de cierre.

Mejoras futuras: división por días; filtrado nativo por categoría y enriquecimiento de /places/nearby con categorías, estos dos últimos dependientes del backend principal. No están implementados ni requieren cambios de Flutter en este cierre. Ver [ITINERARIOS_SENCILLOS.md](ITINERARIOS_SENCILLOS.md).
