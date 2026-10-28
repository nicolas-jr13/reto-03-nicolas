// Estas URL hacen que el empaquetado de Vercel copie los archivos al despliegue.
// Si solo se leen con una ruta calculada, la función llega sin web/ ni fixtures/.
export const trazas = [
  new URL("../web/index.html", import.meta.url),
  new URL("../agent/prompt.md", import.meta.url),
  new URL("./knowledge/registro-proveedor.md", import.meta.url),
  new URL("../fixtures/reto-01/glosario-campos.json", import.meta.url),
  new URL("../fixtures/reto-01/repositorio/maestro.json", import.meta.url),
  new URL("../fixtures/reto-01/repositorio/soportes/index.json", import.meta.url),
  new URL("../fixtures/reto-01/repositorio/soportes/camara-comercio-2026-08.txt", import.meta.url),
  new URL("../fixtures/reto-01/repositorio/soportes/certificacion-bancaria-2026-08.txt", import.meta.url),
  new URL("../fixtures/reto-01/repositorio/soportes/estados-financieros-2025.txt", import.meta.url),
  new URL("../fixtures/reto-01/repositorio/soportes/iso-9001-2025.txt", import.meta.url),
  new URL("../fixtures/reto-01/repositorio/soportes/parafiscales-2026-07.txt", import.meta.url),
  new URL("../fixtures/reto-01/repositorio/soportes/rut-2026.txt", import.meta.url),
  new URL("../fixtures/reto-01/casos/co-industrias-delta/solicitud.json", import.meta.url),
  new URL("../fixtures/reto-01/casos/co-industrias-delta/plantilla-celdas.json", import.meta.url),
  new URL("../fixtures/reto-01/casos/co-industrias-delta/soportes-exigidos.json", import.meta.url),
  new URL("../fixtures/reto-01/casos/ec-corp-andina/solicitud.json", import.meta.url),
  new URL("../fixtures/reto-01/casos/ec-corp-andina/plantilla-campos.json", import.meta.url),
  new URL("../fixtures/reto-01/casos/ec-corp-andina/soportes-exigidos.json", import.meta.url),
  new URL("../fixtures/reto-01/casos/hn-agroexport-sula/solicitud.json", import.meta.url),
  new URL("../fixtures/reto-01/casos/hn-agroexport-sula/plantilla-celdas.json", import.meta.url),
  new URL("../fixtures/reto-01/casos/hn-agroexport-sula/soportes-exigidos.json", import.meta.url),
  new URL("../fixtures/reto-01/casos/pa-logistica-istmo/solicitud.json", import.meta.url),
  new URL("../fixtures/reto-01/casos/pa-logistica-istmo/plantilla-campos.json", import.meta.url),
  new URL("../fixtures/reto-01/casos/pa-logistica-istmo/soportes-exigidos.json", import.meta.url),
]

export const paginaHtml = trazas[0]
export const glosarioCampos = trazas[3]
