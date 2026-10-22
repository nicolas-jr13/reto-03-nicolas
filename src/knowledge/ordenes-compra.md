# Órdenes de compra

La analista recibe un correo con la solicitud, la cotización y la aprobación del líder. Hoy digita en SAP proveedor, descripción, centro de costo, subárea, valor, IVA, aprobador y condiciones de pago, y adjunta el correo de aprobación. Este conocimiento describe el criterio. Las herramientas ejecutan las reglas: un cambio de una regla se hace en `src/validate.ts`, no en el servidor.

## Qué se considera completo

El paquete trae correo, solicitud y, cuando el correo los anuncia, cotización y aprobación. La factura es opcional. Si falta un adjunto anunciado, el campo queda en null y el nombre aparece en `faltantes`. Eso no lanza una excepción.

## Controles

Un bloqueo impide crear la orden. Una confirmación permite crearla solo después de que la analista lo acepte en un mensaje posterior. Un derivado se informa: completa un dato ausente desde el maestro y no pide confirmación, salvo el IVA.

- RC1. El proveedor existe por NIT (si no hay NIT, por nombre normalizado) y está activo. Si no, bloqueo.
- RC2. Hay aprobación, el texto contiene "Aprobado" y el remitente es aprobador de ese centro de costo. Si no, bloqueo.
- RC3. El valor total no supera el tope de ese aprobador en ese centro. Si no, bloqueo.
- RC4. La subárea pertenece al centro. Si no, bloqueo.
- RC5. La cotización no se aparta más de 2 % del total de la solicitud. Si se aparta, o si no hay cotización, confirmación. La orden conserva el valor de la solicitud.
- RC6. Si falta el IVA, se deriva el indicador del proveedor y se pide confirmación. Un código que no está en el maestro bloquea.
- RC7. Si faltan las condiciones de pago, se derivan del proveedor y solo se informan.
- RC8. Si la factura es anterior a la solicitud, la orden es retroactiva y exige confirmación. Se registra; no se rechaza sola.
- RC9. Si la aprobación es anterior a la solicitud, se pide confirmación.
- RC10. Cantidad por valor unitario debe cuadrar con el total, con una tolerancia de una unidad monetaria. Si no, bloqueo.

## Qué ve la analista

Antes de crear, ve la orden como quedaría en SAP y la lista de bloqueos o confirmaciones. Después de crear, ve el número de OC, la fecha y la ruta de la evidencia. La evidencia conserva de, para, fecha, asunto, cuerpo y el sha256 del texto.

## Qué no hace el agente

No pide la aprobación al líder: el líder ya escribió. No registra recepción, factura contable ni pago. No se conecta a un SAP real; el adaptador de archivos simula el alta y la idempotencia por `solicitud_id`.
