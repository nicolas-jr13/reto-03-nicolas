# Solución — agente de órdenes de compra

## 1. Problema

La analista administrativa digita a mano, por cada factura, una orden de compra que ya llegó armada en un correo. Le duele el tiempo, el error de un centro de costo y la falta de una medida de cuántas órdenes nacen después de la factura.

## 2. Arquitectura

El navegador habla con un solo proceso Bun. Ese proceso sirve el chat y corre el ciclo del agente. El ciclo no calcula montos: llama herramientas. Las herramientas leen `fixtures/reto-03/` y escriben `out/`.

```
web/index.html
    │  POST /api/chat
    ▼
src/server.ts
    │
    ▼
src/agent/loop.ts ── lee agent/prompt.md y src/knowledge/ordenes-compra.md
    │
    ├── src/llm/openai.ts     (adaptador; el ciclo no conoce al proveedor)
    └── src/tools/oc.ts       (única fuente de cifras)
            ├── src/validate.ts
            ├── src/payload.ts
            ├── src/evidence.ts
            └── src/sap/mock.ts  →  out/sap/ordenes.jsonl
```

El comportamiento vive en `agent/prompt.md`. El criterio de negocio vive en `src/knowledge/ordenes-compra.md` y se ejecuta en `src/validate.ts`. El servidor solo orquesta. `modulo/` reexporta las mismas herramientas y repite el mismo prompt y el mismo conocimiento, con el frontmatter que pide el reto.

## 3. Ciclo del agente

Cada turno recarga el prompt y el conocimiento, anexa el mensaje y llama al adaptador. Si el modelo pide herramientas, el servidor las valida con Zod, las ejecuta y devuelve el JSON al modelo. El tope es `MAX_TOOL_ITERATIONS` (25). Al llegar, el turno responde con lo ya obtenido.

La confirmación no depende de que el modelo se porte bien. `oc_crear` solo acepta `confirmado: true` si el turno anterior terminó pidiendo confirmación y el mensaje nuevo de la analista es una aceptación (`confirmo`, `sí`, `adelante`). Un "confirmo" dentro del primer mensaje no autoriza la creación. El front muestra un aviso y un botón cuando `needsConfirmation` es verdadero.

Cada llamada queda en el historial y en `out/log.jsonl`. Un error del proveedor se escribe en el chat y la sesión sigue.

## 4. Modelo

Proveedor Groq, modelo `qwen/qwen3.8-27b`, por el endpoint compatible con OpenAI (`https://api.groq.com/openai/v1`). El ciclo sigue llamando a `enviar(mensajes, herramientas)`; Groq entra solo con la URL y la clave. Lo elegí porque hay cupo gratuito y este modelo llama herramientas, incluidas varias en el mismo turno.

Un caso de esta demo cabe en el cupo gratuito. El tope de iteraciones y el de tokens de sesión evitan dejar una conversación abierta si más adelante la cuenta pasa a un plan de pago.

## 5. Matriz de controles

| Regla | Implementación | Salida en los fixtures |
|---|---|---|
| RC1 | NIT con tolerancia al dígito de verificación; si no hay NIT, nombre sin tildes ni puntuación. Inactivo también bloquea. | `sol-002` no existe. El inactivo del maestro se prueba en `demo.ts` fuera de los seis casos. |
| RC2 | Debe existir aprobación, contener "Aprobado" y el remitente estar en el centro. "No aprobado" no cuenta. | `sol-003`: Felipe Vargas no aprueba `CC-2020`. |
| RC3 | Solo si el remitente sí es aprobador de ese centro y el total supera su tope. | No ocurre en los seis. `demo.ts` lo fuerza con un clon de `sol-001`. |
| RC4 | La subárea tiene que estar en la lista del centro. Centro desconocido bloquea. | Cubierto con un clon en `demo.ts`. |
| RC5 | Diferencia absoluta sobre el total de la solicitud, tope 2 %. Sin cotización, confirmación. La OC no copia el valor de la cotización. | `sol-004`: 26.500.000 contra 25.000.000 (6 %). |
| RC6 | IVA ausente se deriva y se confirma. Código desconocido bloquea. | `sol-006` deriva `C1`. |
| RC7 | Condición ausente se deriva y solo se informa. | `sol-006` deriva `Z030`. |
| RC8 | Factura anterior a la solicitud marca `retroactiva` y pide confirmación. | `sol-005`: factura 2026-08-10, solicitud 2026-08-27. |
| RC9 | Aprobación anterior a la solicitud pide confirmación. | Cubierto con un clon en `demo.ts`. |
| RC10 | `cantidad × valor_unitario` contra `valor_total`, tolerancia de 1. | Cubierto con un clon en `demo.ts`. |

Lo más difícil fue RC5 junto con el payload. En `sol-004` la cotización y el correo del líder no dicen el mismo número: el líder aprueba 25 millones "según la solicitud" y la oferta dice 26,5. La orden se arma con la solicitud. `oc_crear` vuelve a calcular y rechaza el payload si un precio, un centro o un IVA no coinciden. El modelo no puede corregir el monto para que cierre.

## 6. Adaptador SAP real

Elegiría OData `API_PURCHASEORDER_PROCESS_SRV` si el sistema es S/4 y la red hasta el API management está permitida. Es la API documentada de órdenes de compra, se prueba con un cliente HTTP y no abre puertos RFC. Si solo hay ECC y BASIS habilita RFC, el plan alterno es `BAPI_PO_CREATE1`. No usaría Integration Suite como primera opción: añade una plataforma antes de saber si la conexión es viable.

Mapeo del payload de este reto a la API de proceso de orden:

| Este reto | Estructura SAP |
|---|---|
| `sociedad` | `CompanyCode` |
| `organizacion_compras` | `PurchasingOrganization` |
| `proveedor.codigo_sap` | `Supplier` |
| `moneda` | `DocumentCurrency` |
| `condiciones_pago` | `PaymentTerms` |
| `referencia.solicitud_id` | texto de cabecera o campo de referencia, para buscarla después |
| posición `numero` | `PurchaseOrderItem` (10, 20, 30) |
| `descripcion` | texto breve, 40 caracteres |
| `cantidad` / `unidad` | `OrderQuantity` / `PurchaseOrderQuantityUnit` |
| `precio_unitario` | condición de precio de la posición |
| `centro_costo` + `subarea` | imputación de la posición |
| `indicador_iva` | `TaxCode` |
| evidencia | anexo del business object, con el PDF y el sha256 en un texto |

Las credenciales vivirían en el entorno del conector o en un almacén de secretos, en un proceso distinto del agente. El prompt y las herramientas no las ven. El agente seguiría hablando con una interfaz `SapAdapter`.

Idempotencia: antes de crear, consultar por el `solicitud_id` guardado en la referencia. Si SAP ya devolvió número, se responde ese número. Si SAP responde error sin número de documento, no se marca como creada y se puede reintentar. Si responde número y además un aviso, se guarda el número y se detiene: reintentar crearía otra orden. Un error parcial de anexo no borra la orden; queda creada y la evidencia se reintenta aparte.

Plan B, si la conexión no es viable: las mismas herramientas dejan la orden, la trazabilidad y el PDF. Con eso la analista pega la cabecera en SAP o se genera un archivo de carga masiva. El control (bloqueos, confirmaciones y retroactivas) ya quedó hecho antes del pantallazo.

## 7. Lectura para dirección

`sol-005` muestra el desvío que hoy no se mide: la factura es del 10 de agosto y la solicitud del 27. La orden nace para poder radicar un gasto que ya ocurrió. Cada caso así queda con `retroactiva = true` en `out/control.csv`, así que el porcentaje sale de contar filas y no de una muestra manual.

El cambio de proceso que propondría es separar la compra del registro de la factura. La orden se crea cuando el líder aprueba la cotización, y la factura solo se radica si esa orden ya existe. Las retroactivas no se prohíben en esta primera versión: se confirman y se cuentan. Con un mes de medición, dirección puede decidir si el siguiente paso es devolverlas o exigir una justificación distinta.

## 8. Decisiones

1. `oc_crear` recalcula la orden y compara el payload. La alternativa era fiarse del JSON del modelo. La descarté porque el propio riesgo del reto es que el modelo ajuste un monto para que cuadre con la cotización.
2. Un proceso Bun sirve la API y el HTML. La alternativa era un front con su propio servidor de desarrollo. La descarté porque el arranque pedido es un comando y menos de dos minutos.
3. El ciclo depende de `enviar(mensajes, herramientas)` y Groq se usa como API compatible. La alternativa era acoplar el bucle al SDK de Groq. La descarté porque cambiar de proveedor no debe reescribir la confirmación ni el tope.
4. Cuando la cotización y la solicitud difieren, la orden usa la solicitud. La alternativa era tomar la cotización o promediar. La descarté: el líder aprueba la solicitud y el agente no tiene autoridad para cambiar el valor.

## 9. Supuestos

- "Aprobado" se busca como palabra, sin distinguir mayúsculas. "No aprobado" o "rechazado" no cuentan.
- Un IVA o una condición informados y ausentes del maestro bloquean. El PRD solo detalla el caso en que faltan.
- Cada solicitud de estos fixtures es una posición. La unidad, que no viene en el Excel, es `UN`.
- Sociedad y organización de compras son `1000`, como fija el esquema.
- `confirmado_por` es la cadena `analista`, porque el reto no tiene usuarios.
- La referencia de cotización es el código de la primera línea del texto (`COT-TS-2026-0451`). Si no hay cotización, va null.
- El NIT de la cotización trae dígito de verificación y el maestro no. El cruce acepta ese dígito de más.
- La fuente `correo` y la fuente `aprobacion` nombran documentos de entrada. El PRD lista solicitud, cotización, maestro y derivado; estos dos documentos son del mismo tipo que la cotización.
- La factura solo es un faltante si el correo la anuncia. En el flujo normal, null no es un error.
- Una orden retroactiva se mide y se confirma. No se rechaza. Esa política queda fuera del reto.
- `oc_leer_excel` no se implementó. Los fixtures ya traen la solicitud en JSON.

## 10. Cobertura

| Historia | Estado | Para producción |
|---|---|---|
| HU-1 Leer el paquete | Hecho | Llegar desde el buzón real, no desde una carpeta. |
| HU-2 Validar | Hecho | Consultar maestros en SAP, no en JSON. |
| HU-3 Payload y trazabilidad | Hecho | Varias posiciones y unidades distintas de `UN`. |
| HU-4 Evidencia | Hecho (txt y pdf) | Firmar el PDF si auditoría lo exige. |
| HU-5 Crear, idempotencia y control | Hecho en el mock | El adaptador OData de la sección 6. |
| HU-6 Errores legibles | Hecho | Los mismos mensajes cuando falle el SAP real. |
| Lectura de Excel real | No hecho | P1. El contrato ya reserva `oc_leer_excel`. |

## 11. Uso de IA

Usé Cursor para leer el PRD, contrastar los seis fixtures y escribir esta implementación. Revisé las reglas contra los datos: `sol-002` no está en el maestro, `sol-003` lo aprueba un líder de otro centro, `sol-004` difiere 6 %, `sol-005` factura antes de solicitar y `sol-006` no trae IVA ni condición.

Descarté de lo que el asistente podía haber hecho: conectar un SAP real, meter las reglas solo en el prompt, guardar sesiones en una base de datos y tomar el valor de la cotización cuando no cierra con la solicitud. El prompt ordena el diálogo. Las cifras salen de las herramientas.

## 12. Riesgos al salir a producción

- El maestro de archivos se desactualiza. Mitigación: `consultarProveedor` ya está en la interfaz; en producción lee SAP.
- Un reintento crea dos órdenes. Mitigación: buscar por `solicitud_id` antes de crear, también en el SAP real, y no reintentar si ya hubo número de documento.
- La analista confirma un texto ambiguo. Mitigación: solo cuenta una aceptación al inicio del mensaje siguiente, y el botón del chat envía `confirmo`.
- La evidencia en PDF no reemplaza una firma. Mitigación: dejar el sha256 y, si auditoría lo pide, sustituir el generador sin cambiar el ciclo.
- El modelo se salta una pregunta. Mitigación: `oc_crear` vuelve a validar y no acepta la confirmación que él mismo escriba.
