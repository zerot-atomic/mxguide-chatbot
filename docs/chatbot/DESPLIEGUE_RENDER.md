# Despliegue Render — Mictlán

Preparación de entrega, 2026-11-04. **No se desplegó ni se modificó Render en esta fase. No se declara listo para producción.** Las configuraciones de código se verificaron localmente; settings reales, secretos, conectividad y cuotas en Render quedan pendientes del equipo. Instrucciones para ejecutar solo después de autorización.

## Verificado en el repositorio

- API NestJS independiente, sin base de datos propia ni migraciones.
- package.json declara Node >=20; render.yaml propone NODE_VERSION=22. Como main usa process.loadEnvFile, utilizar Node 22 compatible con el archivo de lock y validar la versión efectiva antes del despliegue; no se probó toda versión >=20.
- Build: `npm ci && npm run build`. Start: `npm run start:prod` (= node dist/main.js).
- Escucha en `0.0.0.0` y PORT configurable; default local 3000, aceptar PORT inyectado por plataforma.
- render.yaml: Web Service, runtime node, name mxguide-chatbot, plan free, autoDeploy true y healthCheckPath /health. Estos valores son una plantilla del repo, no prueba de los settings actuales del dashboard.
- No se añadió dependencia, Dockerfile, script de despliegue, health check externo ni infraestructura nueva.

## Variables exactas

Valores de ejemplo son ficticios y no deben crearse como un archivo de secretos en Git. Al menos una clave de proveedor es obligatoria para iniciar. Modelos de la tabla son **defaults del código**, no una validación de que una cuenta tenga acceso o cuota para ellos.

| Variable | Default real / restricción | Ejemplo ficticio o decisión |
|---|---|---|
| PORT | 3000; entero 1–65535 | Usar valor de Render, no fijar el de otro servicio |
| GEMINI_API_KEY | ausente | `FICTICIO_NO_UTILIZABLE_GEMINI`; cargar valor real solo en gestor autorizado |
| GEMINI_MODEL | gemini-3.6-flash | Confirmar disponibilidad real del modelo configurado |
| GROQ_API_KEY | ausente | `FICTICIO_NO_UTILIZABLE_GROQ`; cargar valor real solo en gestor autorizado |
| GROQ_MODEL | openai/gpt-oss-120b | Confirmar acceso/cuota de cuenta |
| PRIMARY_PROVIDER | gemini; gemini o groq | groq si se aprueba como principal |
| CHAT_STRATEGY | fallback; fallback o race | fallback para evitar doble llamada habitual, sin cambiar configuración actual automáticamente |
| PROVIDER_TIMEOUT_MS | 25000; entero 1000–120000 | 25000 |
| MAX_OUTPUT_TOKENS | 4096; entero 64–32768 | 4096; no equivale al límite de bytes HTTP |
| MXGUIDE_API_URL | ausente; si falta se producen avisos de catálogo | `https://catalogo.example.invalid`; reemplazar por origen del backend principal confirmado |
| PLACES_TIMEOUT_MS | 15000; entero 1000–120000 | 15000 |
| CHAT_API_KEY | ausente; si falta, acceso público a chat | `FICTICIO_NO_UTILIZABLE_CHAT`; mantener política acordada con Flutter |
| CORS_ORIGINS | lista vacía, origin=true (refleja origen) | `https://app.example.invalid`, o varios separados por comas |
| RATE_LIMIT_PER_MINUTE | 20; entero 1–10000 | 20 |
| NODE_VERSION | no la lee AppConfig; setting de plataforma en render.yaml =22 | 22, verificando revisión concreta |

No existen XAI_API_KEY, GROK_MODEL, DATABASE_URL, SESSION_SECRET, JWT_SECRET ni nuevas keys como parte del contrato de este chatbot. El README histórico contiene referencias a Grok/xAI; esta guía se basa en código real y no lo modifica.

MXGUIDE_API_URL admite http/https sin credenciales en URL, query o fragmento; se recorta slash final. Usar HTTPS en producción. No se siguen redirects en catálogo ni proveedores, por lo que debe apuntar al destino final autorizado. La URL del catálogo ya presente en render.yaml es `https://mxguide-backend.onrender.com`; confirmar con su responsable que siga siendo la correcta. No adjuntar tokens en query ni reenviar la key de Flutter al backend o a la IA.

## Instalación y validación previa

En un checkout revisado, con herramientas instaladas:

```powershell
node --version
npm ci
npm test -- --runInBand --no-cache
npm run typecheck
npm run build
```

En esta fase se reutilizó node_modules existente para las comprobaciones; no se volvió a ejecutar npm ci. En Windows sandbox Jest puede fallar por EPERM en su caché temporal; no confundirlo con un fallo funcional y no deshabilitar pruebas. Se ejecutó la suite en un entorno autorizado fuera del sandbox.

Para arranque local ya autorizado, configurar claves fuera de Git y ejecutar `npm run start:prod`. main carga .env local si existe; en Render se usan variables de entorno de plataforma. No copiar .env al equipo ni a un artifact de entrega. No ejecutar un POST real a IA como parte de tests automatizados.

## Procedimiento de despliegue propuesto, no ejecutado

1. Obtener aprobación de riesgos y despliegue; confirmar repositorio, rama/commit exacto, cuenta y servicio del chatbot, manteniendo el backend principal separado.
2. En Render, preparar un **Web Service Node** conectado al repo autorizado. Revisar la plantilla render.yaml o configurar los comandos verificados arriba. No conectar por error el servicio de catálogo.
3. Seleccionar explícitamente la rama aprobada. La principal remota observada en Git local es origin/main; el trabajo está en chatbot/filtro-estados. No asumir que la rama conectada actualmente es alguna de ellas sin dashboard.
4. Revisar autoDeploy antes de cualquier push: el YAML contiene true, así que publicar una rama vinculada puede desplegar automáticamente. La autorización de push no implica por sí sola autorización de desplegar. Acordar primero con el operador un flujo que no dispare despliegue no autorizado.
5. Introducir variables reales en el gestor del servicio por el responsable, sin copiarlas a capturas, terminal compartida ni repositorio. Confirmar al menos un proveedor, modelo y cuota; rotaciones no forman parte de esta guía de ejecución.
6. Configurar build/start y /health. Mantener PORT de la plataforma y la aplicación escuchando en 0.0.0.0. Confirmar que la cadena de proxies corresponda a trust proxy=1 y que no haya ruta directa que permita suplantar X-Forwarded-For.
7. Desplegar solo con autorización explícita. Registrar commit y resultado sin secretos. Compartir con Flutter la URL HTTPS del chatbot y la política de acceso por canal seguro.

La documentación oficial respalda el flujo [Web Service Node](https://render.com/docs/deploy-node-express-app) y la configuración de [HTTP health checks](https://render.com/docs/health-checks). Los comandos específicos de este repo son npm ci, build y start:prod, no los comandos de aplicaciones de ejemplo de Render.

## Conectividad y smoke test posterior, pendientes

- GET `{CHATBOT_URL}/health` debe responder 200 y JSON con status, strategy, primary y presencia booleana de claves. GET `/` responde nombre y estado. Ambos son públicos y están exentos del throttling.
- No usar /health como prueba de cuota, validez de keys, capacidad de generar texto o acceso al catálogo: no realiza esas llamadas.
- Con autorización del responsable, verificar desde la red del chatbot GET `{MXGUIDE_API_URL}/states` y `/places?stateId=UUID_OBTENIDO&limit=15`. No usar UUID inventados como pruebas de catálogo real. Inspeccionar solo campos necesarios y no registrar bodies sensibles.
- Después de aprobar consumo, hacer un POST /chat mínimo, otro por estado/categoría y uno cercano con ubicación de prueba consentida; comparar IDs con el catálogo. Estos smoke tests consumen IA si hay candidatos; están pendientes y nunca se ejecutan automáticamente en Jest.
- Confirmar 200 locales sin tarjetas, 400/401/413, CORS en Flutter web, latencia y cuotas. Evitar inducir 429 o agotar proveedores reales: escenarios de fallo ya se cubren con mocks. Una prueba controlada de rate limit requiere coordinación y no debe ser fuerza bruta.
- Integración Flutter real (Android/iOS/web) aún pendiente. Los tests NestJS y Postman no certifican permisos, navegación, TLS o rendering de la app.

## Límites, timeouts y consumo

POST acepta JSON hasta 64 KiB; message hasta 1000, history hasta 20 turnos de 4000 y userName hasta 60. Ventana local de history: 12 turnos. Number lat/lng dentro de rango. El proveedor recibe historial vacío, sin userName o location; query redactada parcialmente más intención/candidatos en JSON user, sistema estático. No hay anonimización universal de datos escritos libremente.

Catálogo: máximo 2 MiB por respuesta; proveedor: 256 KiB, contados durante lectura. No hay llamadas HTTP arbitrarias elegidas por el modelo ni reintentos ilimitados. fallback intenta una vez cada proveedor activo en orden; race lanza ambos y toma el primero que resuelve generate. Una respuesta de selección inválida genera fallback **local**, sin otra llamada. Un fallo de ambos produce 503.

Caché de estados/destacados de diez minutos en memoria, estados con refresco compartido. No hay cache persistente, almacén compartido de rate limit, historial durable ni límite global de concurrencia. Reinicios eliminan cachés y contadores. Dos consultas de catálogo y dos proveedores pueden acumular sus timeouts; no existe deadline global de servidor. El equipo debe acordar timeout de Flutter y carga admisible.

### Plan free: solo si se confirma que está en uso

El repo propone plan free, pero el plan real no se inspeccionó. La documentación actual de [Render Free](https://render.com/docs/free) indica suspensión de un Web Service gratuito tras 15 minutos sin tráfico entrante y demora de arranque al volver a recibir solicitudes. Si chatbot o catálogo usan ese plan, puede aumentar la latencia de la primera consulta. No se certifica el tiempo de arranque concreto ni se recomiendan pings para eludir la suspensión. Revisar plan y límites antes de producción; Render presenta ese plan para pruebas y previsualizaciones.

## Rollback, solo ante autorización del operador

Registrar antes del despliegue el commit estable y conservar una prueba de humo de referencia. Si la nueva versión falla, el responsable puede abrir Deploys en Render, elegir un despliegue exitoso retenido y usar Rollback, confirmando el destino. Según [Render Rollbacks](https://render.com/docs/rollbacks), el dashboard desactiva autodeploy al hacer rollback; confirmar ese estado y no reactivarlo hasta resolver la causa. La disponibilidad de artifacts retenidos depende del plan. No asumir que se recuperarán todas las variables actuales ni rotaciones: revisar settings efectivos, conectividad y contrato tras volver atrás.

Si no hay artifact, preparar un redeploy del commit estable aprobado con configuración revisada. No ejecutar git reset, force push, reversión de base de datos o rollback del backend principal como parte del chatbot. No usar push a una rama vinculada como rollback improvisado. Registrar incidente, aprobación y resultado sin tokens; ejecutar smoke tests autorizados y coordinar el fix antes de reanudar entregas automáticas.

## Riesgos abiertos: aceptar o resolver antes de producción

| Riesgo | Decisión pendiente del equipo |
|---|---|
| CHAT_API_KEY opcional y extraíble del cliente | Acordar protección del servicio; JWT/identidad requiere coordinación con Flutter/backend |
| Rate limit por IP/proceso y trust proxy=1 | Verificar proxy real, spoofing, NAT y escalado; evaluar cuotas compartidas |
| Cuotas, gasto y errores 429/5xx de proveedores | Presupuesto, monitoreo sin PII y procedimiento de incidentes |
| race consume ambos; perdedor sin cancelación | Aceptar costo o diseñar cancelación compatible; no se cambió estrategia |
| Nearby no trae categorías en contrato observado | General funciona; específicas pueden aclarar limitación; falta contrato mejorado del backend |
| Recuperación estatal específica de 100 | Muestra no exhaustiva; filtro remoto por categoría o paginación documentada pendientes |
| Sin memoria persistente | Flutter conserva sesión y respeta límites; no prometer continuidad tras perder history |
| Formato JSON de IA no garantizado | Renderer local seguro; medir pertinencia y frecuencia de fallback en entorno autorizado |
| Curación de texto, referencias ofuscadas y privacidad de query | Revisar catálogo y uso de datos; filtros actuales son conservadores/heurísticos |
| Integración/infraestructura reales no verificadas aquí | Aceptación del equipo y pruebas con Flutter antes de declarar producción |

Estado: documentación y comprobaciones locales completas; despliegue e integración real pendientes. Esta guía no modifica políticas, cuentas, secretos o settings de Render.
