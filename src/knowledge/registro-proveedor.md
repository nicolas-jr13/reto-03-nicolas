# Registro como proveedor

Periferia responde solicitudes de clientes en Colombia, Ecuador, Perú, Panamá y Honduras. Los datos salen del maestro `fixtures/reto-01/repositorio/maestro.json` y los sinónimos, del glosario `fixtures/reto-01/glosario-campos.json`. Los soportes salen de `fixtures/reto-01/repositorio/soportes/`.

## Campos

Cada etiqueta queda en un solo estado:

- lleno: hay valor en el maestro y la confianza es de al menos 0.85.
- faltante: no hay fuente. No se inventa un valor. No bloquea la firma, pero se lista en el checklist.
- requiere_confirmacion: la confianza está bajo 0.85, la etiqueta es ambigua o el identificador tributario corresponde a otro país.

El identificador del país del cliente es NIT en Colombia, RUC en Ecuador, Perú y Panamá, y RTN en Honduras. Periferia solo tiene NIT colombiano. En otro país el valor propuesto es ese NIT y la nota es «identificador extranjero». Una etiqueta ambigua, como «Identificación tributaria», también pide confirmación y propone el equivalente del país.

Los datos bancarios se llenan solo cuando la plantilla los pide. No entran en `borrador-correo.md`.

## Soportes

La vigencia se compara con la fecha de ejecución:

- presente: el archivo existe y no está vencido.
- vencido: `vigencia_hasta` es anterior a la fecha de ejecución. Bloquea `listo_para_firma`.
- ausente: el cliente lo exige y no está en el repositorio. Bloquea `listo_para_firma`.

Un soporte vencido puede copiarse al paquete para que la analista lo vea, pero el estado de firma sigue bloqueado.

## Formatos

- xlsx: `out/<caso>/formulario.xlsx`, con cada etiqueta y su valor en la hoja y la celda de la plantilla.
- pdf: `out/<caso>/formulario.pdf`, con etiqueta y valor en el orden de la plantilla.
- portal: no se abre el sitio ni se usan credenciales. Se escribe `out/<caso>/valores-portal.md` y la respuesta dice «formato no soportado».

## Paquete y envío

El paquete queda en `out/<caso>/paquete/` con el formulario, las copias de los soportes encontrados, `checklist.md` y `borrador-correo.md`.

El envío no sale del sistema. Solo después de una confirmación explícita de la analista en el turno anterior se escribe `out/<caso>/ENVIO-SIMULADO.md`.

El agente no firma.
