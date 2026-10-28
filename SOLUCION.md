# Solución — Registro como proveedor

## 1. Problema en una frase

El área administrativa transcribe a mano, una y otra vez, datos que ya están en el maestro para registrar a Periferia como proveedor; le duele a la analista, que pierde días entre formularios, soportes y el riesgo de copiar mal un NIT o una cuenta.

## 2. Arquitectura

```text
web/index.html
    │  POST /api/chat
    ▼
src/server.ts
    ▼
src/agent/loop.ts          estados, historial y tope de iteraciones
    │
    ├── agent/prompt.md                    comportamiento
    ├── src/knowledge/registro-proveedor.md conocimiento del proceso
    ├── src/llm/factory.ts                 elige el adaptador
    │     ├── anthropic.ts                 @anthropic-ai/sdk
    │     └── openai.ts                    endpoint compatible (Groq en las pruebas)
    └── src/tools/proveedor.ts             única fuente de valores
            │
            ├── fixtures/reto-01/          solo lectura
            └── out/<caso>/                formulario, paquete y bitácora
```

El servidor solo concatena el prompt y el conocimiento, y ejecuta el ciclo. Una regla de negocio se cambia en `src/knowledge/` o en las herramientas, no en el HTTP. El módulo `modulo/` reexporta las mismas herramientas y repite el mismo prompt y el mismo conocimiento.

## 3. Ciclo del agente

Cada turno guarda el historial en `out/sessions/<id>.json`, junto con el caso activo y el estado: `inicio`, `solicitud_leida`, `campos_mapeados`, `formulario_generado`, `esperando_confirmacion`, `envio_simulado`.

El bucle pide una respuesta al modelo con las cinco herramientas. Si propone llamadas, el servidor valida los argumentos con zod, ejecuta la función y devuelve `{ ok, data }` o `{ ok: false, error }`. Ninguna herramienta lanza hacia el modelo. El tope es `MAX_TOOL_ITERATIONS` (25). Hay otro tope aproximado de tokens por sesión.

La confirmación humana se exige en dos puntos. Si el mapeo trae `requiere_confirmacion`, o si el paquete ya está armado, el turno termina con una pregunta y el chat lo marca. `proveedor_simular_envio` solo escribe `ENVIO-SIMULADO.md` cuando el argumento `confirmado` es true y el mensaje de ese turno es una confirmación explícita (`envía`, `sí`, `confirmo`). «No envíes» no cuenta. Cada llamada queda en el chat y en `out/log.jsonl`, y también en `out/<caso>/log.jsonl`.

## 4. Elección del modelo

Las pruebas de esta entrega corrieron con **Groq**, modelo **`qwen/qwen3.8-27b`**, por el endpoint `https://api.groq.com/openai/v1`. Es la clave que ya estaba en el entorno. `demo.ts` no llama al modelo: valida las reglas con los fixtures.

El código también integra `@anthropic-ai/sdk`. Si `ANTHROPIC_API_KEY` tiene valor, el ciclo usa ese adaptador sin cambiar las herramientas. El modelo por defecto de esa vía es `claude-sonnet-4-5`.

Un caso conversacional hace cuatro llamadas de herramienta y un cierre, del orden de unos pocos miles de tokens. En el cupo gratuito de Groq eso cabe en una sesión. `demo.ts` tiene costo cero.

## 5. Diseño del portal web

El formato portal no se automatiza en este reto. La herramienta responde `formato no soportado` y escribe `out/<caso>/valores-portal.md` para copiar.

En una fase posterior usaría un navegador controlado (Playwright) solo en un equipo de la analista, no en el servidor compartido. El agente abriría el formulario y propondría cada valor; no guardaría la contraseña. Los límites son CAPTCHA, MFA, cambios de layout y sesiones que vencen. Ante cualquiera de esos, el flujo se detiene y la persona sigue a mano con el listado.

Las credenciales vivirían en el gestor del sistema operativo o las escribiría la analista en el momento, en la ventana del navegador. No entran al repositorio, ni al prompt, ni a los logs, ni a los fixtures. El ingreso de usuario y contraseña, y el clic en Enviar, son siempre humanos. El agente no los ejecuta.

## 6. Decisiones y trade-offs

1. **Umbral de confirmación en 0.85.** El PRD marca 0.80 y la rúbrica de la jornada, 85 %. Quedó 0.85, que también cubre el 0.80. La alternativa era usar solo 0.80 y quedar por debajo de la rúbrica.
2. **El formulario se recalcula desde el maestro.** Aunque el modelo entregue un mapeo, los valores escritos salen de otra lectura del maestro. La alternativa era confiar en el JSON del modelo; eso permitía un valor inventado.
3. **Dos adaptadores detrás de una interfaz.** Las pruebas usan Groq porque esa es la clave disponible, y Anthropic queda listo para cambiar de proveedor sin tocar el ciclo. La alternativa era acoplar el bucle a un solo SDK.
4. **PDF generado, no un AcroForm.** El PRD lo acepta y los fixtures no traen el PDF original del cliente. La alternativa era pedir una plantilla binaria que no venía en el reto.

Dependencias: `zod` para los argumentos, `exceljs` para escribir celdas, `pdf-lib` para el PDF y `@anthropic-ai/sdk` para el adaptador de Anthropic.

## 7. Supuestos

- Los cuatro fixtures cubren la variabilidad que hay que demostrar. No se agregaron casos.
- La vigencia se compara con la fecha local de la máquina. El 28 de octubre de 2026 la cámara vence el 30 de septiembre de 2026 y los parafiscales el 31 de agosto de 2026, así que ningún caso queda `listo_para_firma`. Un campo faltante no cambia ese estado; un soporte ausente o vencido sí.
- El identificador extranjero se llena con el NIT colombiano y queda en `requiere_confirmacion`, con la nota «identificador extranjero».
- El diagnóstico de bugs de la entrega anterior salió de este repositorio: esta sesión solo registra proveedores.
- No hay enlace público. La defensa puede correr en local.

## 8. Cobertura

| Historia | Estado | Qué falta para producción |
|---|---|---|
| HU-1 Leer la solicitud | Hecho | Correo real y bandeja de recepción. |
| HU-2 Mapear campos | Hecho | Dueño del maestro y sinónimos nuevos sin editar el glosario a mano. |
| HU-3 Excel | Hecho | Plantillas con celdas combinadas o varias filas repetibles. |
| HU-3 PDF | Hecho | Rellenar el PDF original del cliente, si lo hubiera. |
| HU-3 Portal | Parcial | Solo el diseño y el listado copiable. Falta el navegador asistido de la sección 5. |
| HU-4 Paquete para firma | Hecho | Firma electrónica y envío real. Hoy el envío es un archivo simulado. |
| HU-5 Errores | Hecho | Alertas operativas cuando falle el proveedor en un horario de cierre. |

## 9. Uso de IA

Para construir usé Cursor, con el agente Auto: leí el PRD y los fixtures, retiré el diagnóstico de bugs y escribí el ciclo, las herramientas, el chat, `demo.ts` y este documento.

Descarté dos propuestas que no servían al reto. Mantener el análisis de software mezclaba otro proceso en el mismo agente. Dejar que el modelo completara un campo ausente con un valor plausible rompía la regla de no inventar: el valor solo sale de la herramienta.

Las pruebas deterministas son `bun run demo.ts`, sin modelo. Las pruebas del chat usaron **Groq / `qwen/qwen3.8-27b`**.

## 10. Riesgos

- El modelo puede afirmar un dato que no está en el mapeo. Mitigación: el prompt lo prohíbe y el archivo se genera solo desde el maestro. En producción conviene un cotejo automático entre la respuesta y la bitácora.
- Un soporte vencido puede pasar desapercibido si nadie mira el checklist. Mitigación: `listo_para_firma` queda en false y el chat lo dice. En producción, la firma electrónica debería rechazar el paquete en ese estado.
- El portal con CAPTCHA o MFA no se puede delegar. Mitigación: la persona opera el sitio; el agente solo prepara valores y nunca ve la contraseña.
- La clave del modelo puede filtrarse si alguien copia `.env` o un log. Mitigación: `.env` está ignorado, `/api/health` no la devuelve y las herramientas no ejecutan comandos. En producción la clave vive en el secreto del servidor, con tope de tokens por sesión.
