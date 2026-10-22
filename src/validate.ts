import { dinero, fechaCalendario, nitCoincide, normNombre, porcentaje } from "./text"
import type { CentroCosto, Derivados, Hallazgo, Maestros, Paquete, Proveedor, Validacion } from "./types"

function hallazgo(codigo: string, detalle: string, accion: string): Hallazgo {
  return { codigo, detalle, accion }
}

function buscarProveedor(solicitud: Paquete["solicitud"], maestros: Maestros): Proveedor | null {
  if (solicitud.proveedor_nit) {
    return maestros.proveedores.find((item) => nitCoincide(item.nit, solicitud.proveedor_nit ?? "")) ?? null
  }
  const nombre = normNombre(solicitud.proveedor_nombre)
  return maestros.proveedores.find((item) => normNombre(item.nombre) === nombre) ?? null
}

export function validarPaquete(paquete: Paquete, maestros: Maestros): Validacion {
  const bloqueos: Hallazgo[] = []
  const confirmaciones: Hallazgo[] = []
  const solicitud = paquete.solicitud
  const derivados: Derivados = { unidad: "UN" }
  let retroactiva = false

  const proveedor = buscarProveedor(solicitud, maestros)
  if (!proveedor) {
    const identidad = solicitud.proveedor_nit
      ? `NIT ${solicitud.proveedor_nit} (${solicitud.proveedor_nombre})`
      : `nombre "${solicitud.proveedor_nombre}"`
    bloqueos.push(
      hallazgo(
        "RC1",
        `El proveedor no existe en el maestro: ${identidad}.`,
        "Pida al solicitante el NIT de un proveedor activo o el alta en SAP antes de volver a procesar. No cree la OC.",
      ),
    )
  } else if (!proveedor.activo) {
    bloqueos.push(
      hallazgo(
        "RC1",
        `El proveedor ${proveedor.nombre} (NIT ${proveedor.nit}, código ${proveedor.codigo_sap}) está inactivo.`,
        "Pida un proveedor activo. No use este código SAP.",
      ),
    )
  } else {
    derivados.proveedor = {
      codigo_sap: proveedor.codigo_sap,
      nit: proveedor.nit,
      nombre: proveedor.nombre,
    }
    if (!solicitud.indicador_iva) {
      derivados.indicador_iva = proveedor.indicador_iva_default
      const indicador = maestros.indicadores.find((item) => item.codigo === proveedor.indicador_iva_default)
      confirmaciones.push(
        hallazgo(
          "RC6",
          `La solicitud no informa IVA. Se deriva ${proveedor.indicador_iva_default} (${indicador?.descripcion ?? "sin descripción"}) desde el proveedor.`,
          "Confirme si ese indicador aplica antes de crear la OC.",
        ),
      )
    } else if (!maestros.indicadores.some((item) => item.codigo === solicitud.indicador_iva)) {
      bloqueos.push(
        hallazgo(
          "RC6",
          `El indicador de IVA "${solicitud.indicador_iva}" no existe en el maestro.`,
          "Pida un código de IVA vigente (C0, C1 o C2 en el maestro actual).",
        ),
      )
    }

    if (!solicitud.condiciones_pago) {
      derivados.condiciones_pago = proveedor.condiciones_pago_default
    } else if (!maestros.condiciones.some((item) => item.codigo === solicitud.condiciones_pago)) {
      bloqueos.push(
        hallazgo(
          "RC7",
          `La condición de pago "${solicitud.condiciones_pago}" no existe en el maestro.`,
          "Pida un código de condición de pago vigente.",
        ),
      )
    }
  }

  const centro = maestros.centros.find((item) => item.centro_costo === solicitud.centro_costo)
  const aprobador = centro?.aprobadores.find((item) => item.email.toLowerCase() === paquete.aprobacion?.de.toLowerCase())
  if (!paquete.aprobacion) {
    bloqueos.push(
      hallazgo(
        "RC2",
        "No hay correo de aprobación.",
        "Pida al solicitante el correo del líder con la palabra Aprobado.",
      ),
    )
  } else if (!paquete.aprobacion.aprobado) {
    bloqueos.push(
      hallazgo(
        "RC2",
        "El correo de aprobación no contiene la palabra Aprobado.",
        "Pida una respuesta del líder que diga explícitamente que aprueba.",
      ),
    )
  } else if (!centro) {
    bloqueos.push(
      hallazgo(
        "RC4",
        `El centro de costo ${solicitud.centro_costo} no existe en el maestro.`,
        "Pida el centro de costo correcto antes de evaluar al aprobador.",
      ),
    )
  } else if (!aprobador) {
    const lista = centro.aprobadores
      .map((item) => `${item.email} (tope ${dinero(item.tope, solicitud.moneda)})`)
      .join("; ")
    const cubre = centro.aprobadores.some((item) => solicitud.valor_total <= item.tope)
    bloqueos.push(
      hallazgo(
        "RC2",
        `Quien aprobó (${paquete.aprobacion.de}) no es aprobador del centro ${centro.centro_costo}.`,
        cubre
          ? `Pida la aprobación de uno de estos líderes: ${lista}.`
          : `Pida la aprobación de un líder de ese centro. Los aprobadores actuales (${lista}) tienen un tope inferior al valor ${dinero(solicitud.valor_total, solicitud.moneda)}.`,
      ),
    )
  } else if (solicitud.valor_total > aprobador.tope) {
    bloqueos.push(
      hallazgo(
        "RC3",
        `El valor ${dinero(solicitud.valor_total, solicitud.moneda)} supera el tope de ${aprobador.email} (${dinero(aprobador.tope, solicitud.moneda)}) en ${centro?.centro_costo}.`,
        "Pida aprobación de un líder con tope suficiente para ese centro, o divida la compra si el proceso lo permite.",
      ),
    )
  }

  if (centro && !centro.subareas.includes(solicitud.subarea)) {
    bloqueos.push(
      hallazgo(
        "RC4",
        `La subárea "${solicitud.subarea}" no pertenece al centro ${centro.centro_costo}. Subáreas válidas: ${centro.subareas.join(", ")}.`,
        "Pida al solicitante corregir la subárea.",
      ),
    )
  } else if (!centro && !bloqueos.some((item) => item.codigo === "RC4")) {
    bloqueos.push(
      hallazgo(
        "RC4",
        `El centro de costo ${solicitud.centro_costo} no existe, así que la subárea no se puede verificar.`,
        "Pida un centro de costo del maestro.",
      ),
    )
  }

  if (solicitud.valor_total === 0) {
    bloqueos.push(hallazgo("RC5", "El valor total de la solicitud es cero.", "Pida el monto correcto. No se puede comparar la cotización."))
  } else if (!paquete.cotizacion) {
    confirmaciones.push(
      hallazgo(
        "RC5",
        "No hay cotización adjunta.",
        `Confirme si la OC debe crearse solo con la solicitud por ${dinero(solicitud.valor_total, solicitud.moneda)}.`,
      ),
    )
  } else {
    if (paquete.cotizacion.moneda !== solicitud.moneda) {
      confirmaciones.push(
        hallazgo(
          "RC5",
          `La cotización está en ${paquete.cotizacion.moneda} y la solicitud en ${solicitud.moneda}.`,
          "Confirme la moneda que debe quedar en la OC.",
        ),
      )
    }
    const ratio = Math.abs(paquete.cotizacion.total - solicitud.valor_total) / solicitud.valor_total
    if (ratio > 0.02) {
      confirmaciones.push(
        hallazgo(
          "RC5",
          `La cotización (${dinero(paquete.cotizacion.total, paquete.cotizacion.moneda)}) difiere de la solicitud (${dinero(solicitud.valor_total, solicitud.moneda)}) en ${porcentaje(ratio)}. El tope es 2 %.`,
          "Confirme si la OC debe quedar con el valor de la solicitud. El agente no modifica el monto para cuadrarlo.",
        ),
      )
    }
  }

  if (paquete.factura) {
    const fechaFactura = fechaCalendario(paquete.factura.fecha)
    const fechaSolicitud = fechaCalendario(solicitud.fecha_solicitud)
    if (!fechaFactura || !fechaSolicitud) {
      confirmaciones.push(
        hallazgo(
          "RC8",
          "Hay factura, pero no pude comparar su fecha con la de la solicitud.",
          "Confirme si la OC es retroactiva antes de crearla.",
        ),
      )
    } else if (fechaFactura < fechaSolicitud) {
      retroactiva = true
      confirmaciones.push(
        hallazgo(
          "RC8",
          `La factura ${paquete.factura.numero} tiene fecha ${fechaFactura}, anterior a la solicitud ${fechaSolicitud}. La OC quedaría marcada como retroactiva.`,
          "Confirme si dirección acepta crear esta OC retroactiva. El agente la mide; no la rechaza sola.",
        ),
      )
    }
  }

  if (paquete.aprobacion?.aprobado) {
    const fechaAprobacion = fechaCalendario(paquete.aprobacion.fecha)
    const fechaSolicitud = fechaCalendario(solicitud.fecha_solicitud)
    if (!fechaAprobacion || !fechaSolicitud) {
      confirmaciones.push(
        hallazgo("RC9", "No pude leer la fecha de aprobación o la de la solicitud.", "Confirme que el líder aprobó en o después de la fecha de la solicitud."),
      )
    } else if (fechaAprobacion < fechaSolicitud) {
      confirmaciones.push(
        hallazgo(
          "RC9",
          `La aprobación es del ${fechaAprobacion} y la solicitud del ${fechaSolicitud}.`,
          "Confirme si esa aprobación anterior sigue vigente para esta solicitud.",
        ),
      )
    }
  }

  const cuadrado = Math.abs(solicitud.cantidad * solicitud.valor_unitario - solicitud.valor_total)
  if (!Number.isFinite(cuadrado)) {
    bloqueos.push(hallazgo("RC10", "Cantidad o valores no numéricos.", "Pida el Excel con cantidad, valor unitario y total numéricos."))
  } else if (cuadrado > 1) {
    bloqueos.push(
      hallazgo(
        "RC10",
        `Cantidad × valor unitario (${dinero(solicitud.cantidad * solicitud.valor_unitario, solicitud.moneda)}) no cuadra con el total (${dinero(solicitud.valor_total, solicitud.moneda)}).`,
        "Pida al solicitante corregir el Excel. El agente no ajusta el monto.",
      ),
    )
  }

  return {
    apta: bloqueos.length === 0,
    bloqueos,
    confirmaciones,
    derivados,
    retroactiva,
  }
}

export function codigos(items: Hallazgo[]): string {
  return items.map((item) => item.codigo).join("|")
}
