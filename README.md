# Reto 03 — Agente de órdenes de compra

Agente conversacional que lee un paquete de compra, lo valida contra maestros y crea la orden en un SAP simulado. La clave del modelo solo se lee del entorno.

## Arranque

```bash
bun install
copy .env.example .env
```

Edite `.env` y pegue su clave de Groq en `OPENAI_API_KEY`. La obtiene en https://console.groq.com/keys. Luego:

```bash
bun run dev
```

Abra http://localhost:3000. El chequeo sin clave es http://localhost:3000/api/health.

## Demo sin modelo

```bash
bun install && bun run demo.ts
```

Recorre `sol-001` a `sol-006`, repite `sol-001` para mostrar idempotencia y confirma `sol-004`, `sol-005` y `sol-006`. No usa la clave. Borra `out/` al empezar.

## Variables

| Variable | Uso |
|---|---|
| `OPENAI_API_KEY` | Clave de Groq. No va al front, al repo ni a los logs. |
| `OPENAI_MODEL` | Modelo. Por defecto `qwen/qwen3.8-27b`. |
| `OPENAI_BASE_URL` | Endpoint. Por defecto `https://api.groq.com/openai/v1`. |
| `MAX_TOOL_ITERATIONS` | Tope de idas herramienta-modelo por turno. Por defecto 25. |
| `MAX_SESSION_TOKENS` | Tope aproximado de la sesión. Por defecto 80000. |
| `LLM_TIMEOUT_MS` | Tiempo de espera del proveedor. Por defecto 60000. |
| `PORT` | Puerto local. Por defecto 3000. |

## Link de prueba

La defensa local usa http://localhost:3000. No hay clave de acceso. Un enlace público se publica aparte; si no está activo durante la defensa, esta copia se ejecuta en local.

## API

| Método | Ruta | Respuesta |
|---|---|---|
| `POST` | `/api/chat` | `{ sessionId, message }` → `{ reply, toolCalls, needsConfirmation }` |
| `GET` | `/api/sessions/:id` | Historial de la sesión |
| `GET` | `/api/health` | `{ ok, provider, model }` |
