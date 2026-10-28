# Reto 01 — Registro como proveedor

Agente conversacional que llena el registro de proveedor desde el maestro, lista lo que falta y deja el paquete listo para la firma humana. No firma ni envía.

## Requisitos

- Bun 1.1 o superior

## Instalación

```bash
bun install
copy .env.example .env
```

Pegue la clave en `.env`. Si define `ANTHROPIC_API_KEY`, el agente usa Anthropic. Si no, usa el endpoint OpenAI-compatible (`OPENAI_API_KEY`). La clave no va al front, al repositorio ni a los logs.

## Uso

```bash
bun run dev
```

Abra http://localhost:3000. Elija un caso, por ejemplo `ec-corp-andina`, y pida procesarlo. El chat muestra cada herramienta. Cuando el paquete queda armado, el agente pide confirmación. Solo un mensaje explícito como «envía» escribe `out/<caso>/ENVIO-SIMULADO.md`.

No hay despliegue público en esta entrega. La prueba es local, en el puerto de `PORT` (3000 por defecto).

## Demo sin modelo

```bash
bun run demo.ts
```

Recorre los cuatro casos de `fixtures/reto-01/casos/`, genera Excel, PDF o el listado de portal, arma el paquete y comprueba que el envío sin confirmación se rechaza. No usa la clave. La salida termina en `[PASS] Validación completada.`

## Variables

| Variable | Uso |
|---|---|
| `ANTHROPIC_API_KEY` | Clave de Anthropic. Si tiene valor, es el proveedor activo. |
| `ANTHROPIC_MODEL` | Modelo Anthropic. Por defecto `claude-sonnet-4-5`. |
| `OPENAI_API_KEY` | Clave del endpoint compatible. En las pruebas se usó Groq. |
| `OPENAI_MODEL` | Modelo de ese endpoint. En las pruebas: `qwen/qwen3.8-27b`. |
| `OPENAI_BASE_URL` | Endpoint. Por defecto `https://api.groq.com/openai/v1`. |
| `MAX_TOOL_ITERATIONS` | Tope de idas herramienta-modelo por turno. Por defecto 25. |
| `MAX_SESSION_TOKENS` | Tope aproximado de la sesión. Por defecto 80000. |
| `LLM_TIMEOUT_MS` | Espera del proveedor. Por defecto 60000. |
| `PORT` | Puerto local. Por defecto 3000. |

## API

| Método | Ruta | Respuesta |
|---|---|---|
| `POST` | `/api/chat` | `{ sessionId, message }` → `{ reply, toolCalls, needsConfirmation, estado, caso }` |
| `GET` | `/api/sessions/:id` | Historial, estado e intención activa de la sesión |
| `GET` | `/api/health` | `{ ok, provider, model }` sin la clave |

## Estructura

```text
agent/prompt.md                 comportamiento del agente
src/knowledge/                  reglas del registro
src/tools/proveedor.ts          herramientas, única fuente de valores
src/llm/                        adaptador Anthropic y adaptador compatible
src/agent/loop.ts               ciclo, estados y confirmación
web/index.html                  chat
fixtures/reto-01/               solo lectura
demo.ts                         verificación sin modelo
modulo/                         el mismo prompt, las mismas herramientas y la misma skill
```
