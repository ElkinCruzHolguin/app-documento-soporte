'use strict';
// Convierte una fila del Excel en el JSON de Documento Soporte de Saphety
// (POST /v2/{opv}/outbounddocuments/supportDocument) y valida la fila.

const { conDefaults } = require('../config/parametros');
const { CAPITALES } = require('./capitales');

const PRIMOS_DV = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];

/** Dígito de verificación DIAN para un NIT (solo dígitos). */
function calcularDV(nit) {
  const digitos = String(nit).replace(/\D/g, '');
  if (!digitos) return '';
  let suma = 0;
  for (let i = 0; i < digitos.length; i++) {
    suma += Number(digitos[digitos.length - 1 - i]) * PRIMOS_DV[i];
  }
  const r = suma % 11;
  return String(r > 1 ? 11 - r : r);
}

const texto = (v) => (v === null || v === undefined ? '' : String(v).trim());
const numero = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};
const dinero = (n) => (Math.round((n + Number.EPSILON) * 100) / 100).toFixed(2);
const pad = (v, largo) => {
  const t = texto(v).replace(/\.0+$/, '');
  return t && /^\d+$/.test(t) ? t.padStart(largo, '0') : t;
};

/** Fecha y hora actuales en Bogotá: { fecha: 'aaaa-mm-dd', hora: 'hh:mm:ss' } */
function ahoraBogota(fecha = new Date()) {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(fecha).map((p) => [p.type, p.value]),
  );
  return { fecha: `${partes.year}-${partes.month}-${partes.day}`, hora: `${partes.hour}:${partes.minute}:${partes.second}` };
}

/** Prefijo y número tal como vienen en el Excel. */
function numeracionExcel(d) {
  const prefijo = texto(d.prefijo) || texto(d.tipo);
  let numero = texto(d.folio);
  if (!numero) {
    numero = texto(d.prefijoFolio);
    if (prefijo && numero.toUpperCase().startsWith(prefijo.toUpperCase())) numero = numero.slice(prefijo.length);
  }
  return { prefijo, numero: numero.replace(/\.0+$/, '') };
}

/**
 * @param {object|object[]} datos  fila del Excel (campos de excel.js), o las filas de un mismo
 *   documento (mismo PREFIJO + FOLIO): la primera da el encabezado y cada fila es una línea.
 * @param {object} configuracion  parámetros del perfil activo
 * @param {object} opciones  { numeracion: {prefijo, numero} } para forzar la numeración (consecutivo)
 * @returns {{ json: object|null, errores: string[], advertencias: string[], resumen: object }}
 */
function construirDocumento(datos, configuracion, opciones = {}) {
  const cfg = conDefaults(configuracion);
  const filas = (Array.isArray(datos) ? datos : [datos]).filter(Boolean);
  const d = filas[0] || {};
  const errores = [];
  const advertencias = [];

  // --- Numeración
  const num = opciones.numeracion || numeracionExcel(d);
  if (!num.prefijo) errores.push('Falta el prefijo (columna Prefijo).');
  if (!num.numero) errores.push('Falta el número del documento (PREFIJO + FOLIO o Folio).');
  else if (!/^\d+$/.test(num.numero)) errores.push(`El número "${num.numero}" debe ser solo dígitos.`);
  if (num.prefijo && !/^[A-Za-z0-9]+$/.test(num.prefijo)) errores.push(`El prefijo "${num.prefijo}" no puede tener espacios ni guiones.`);

  // --- Fechas
  const fechaDoc = texto(d.fechaDoc);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaDoc)) errores.push('FECHA_DOC vacía o con formato inválido.');
  const ahora = ahoraBogota();
  const fechaEmision = cfg.fechaEmision === 'hoy' ? ahora.fecha : fechaDoc;
  const issueDate = `${fechaEmision}T${ahora.hora}`;

  // Las filas de un mismo documento deben coincidir en el encabezado.
  for (const [i, f] of filas.entries()) {
    if (i === 0) continue;
    for (const [campo, nombre] of [['identificacion', 'CEDULA O NIT'], ['fechaDoc', 'FECHA_DOC'], ['moneda', 'MONEDA']]) {
      if (texto(f[campo]) !== texto(d[campo])) errores.push(`Línea ${i + 1}: ${nombre} "${texto(f[campo])}" distinto de la primera fila ("${texto(d[campo])}").`);
    }
  }

  const moneda = texto(d.moneda).toUpperCase() || 'COP';

  // --- Adquiriente (configuración)
  if (!cfg.nit) errores.push('Configura el NIT del adquiriente en Administración.');
  if (!cfg.serieExternalKeyDS) errores.push('Configura la SerieExternalKey de DS en Administración.');
  const nitEmisor = texto(d.nitEmisor).replace(/\D/g, '');
  if (nitEmisor && cfg.nit && nitEmisor !== String(cfg.nit).replace(/\D/g, '')) {
    errores.push(`NIT EMISOR ${nitEmisor} no coincide con el NIT configurado (${cfg.nit}).`);
  }

  // --- Proveedor
  const pais = texto(d.pais).toUpperCase();
  const precedencia = texto(d.precedencia);
  const residente = precedencia === '10';
  if (!['10', '11'].includes(precedencia)) errores.push(`PRECEDENCIA "${precedencia}" debe ser 10 (residente) u 11 (no residente).`);
  if (residente && pais && pais !== 'CO') errores.push(`Proveedor residente (10) pero PAIS es ${pais}.`);
  if (precedencia === '11' && pais === 'CO') advertencias.push('Proveedor no residente (11) con PAIS CO.');

  const identificacion = texto(d.identificacion).replace(/\.0+$/, '');
  if (!identificacion) errores.push('Falta CEDULA O NIT del proveedor.');
  const tipoDian = texto(d.tipoDocumento);
  const tipoSaphety = cfg.tiposDocumento[tipoDian];
  if (!tipoSaphety) errores.push(`TIPO DE DOCUMENTO ${tipoDian || '(vacío)'} no tiene equivalencia configurada en Administración.`);
  if (residente && tipoSaphety && tipoSaphety !== 'NIT') {
    errores.push('Para proveedores residentes en Colombia Saphety solo permite tipo de identificación NIT (31).');
  }
  const esNit = tipoSaphety === 'NIT';
  if (esNit && identificacion && !/^\d+$/.test(identificacion)) errores.push(`El NIT "${identificacion}" debe ser solo dígitos.`);

  const tipoPersona = texto(d.tipoPersona);
  const legalType = tipoPersona === '2' ? 'Natural' : 'Legal';
  if (!['1', '2'].includes(tipoPersona)) advertencias.push(`TIPO PERSONA "${tipoPersona}" no es 1 ni 2; se envía como jurídica.`);

  const nombreProveedor = texto(d.proveedor);
  if (!nombreProveedor) errores.push('Falta el nombre del PROVEEDOR.');
  if (legalType === 'Natural') {
    const apellidos = texto(d.apellidos);
    if (!texto(d.nombre) || !apellidos) advertencias.push('Persona natural sin NOMBRE o APELLIDOS.');
    else if (!nombreProveedor.toUpperCase().includes(apellidos.toUpperCase())) {
      advertencias.push(`APELLIDOS "${apellidos}" no aparece en PROVEEDOR "${nombreProveedor}".`);
    }
  }

  const email = texto(d.emailProveedor) || cfg.emailProveedorDefecto;
  if (!email) errores.push('No hay correo del proveedor: el Excel no lo trae y no hay correo por defecto en Administración.');

  const direccion = texto(d.direccion);
  if (!direccion) errores.push('Falta la DIRECCION del proveedor.');
  const address = { AddressLine: direccion, Country: pais };
  if (residente) {
    const dep = pad(d.departamento, 2);
    const ciudad = pad(d.municipio, 5);
    const postal = pad(d.codigoPostal, 6);
    if (!dep || !ciudad) errores.push('Proveedor residente sin DEPARTAMENTO o MUNICIPIO.');
    else if (!ciudad.startsWith(dep)) errores.push(`MUNICIPIO ${ciudad} no pertenece al DEPARTAMENTO ${dep}.`);
    if (!postal) advertencias.push('Proveedor residente sin CODIGO POSTAL: la DIAN puede rechazarlo (regla DSAJ08a).');
    else if (!/^\d{6}$/.test(postal)) advertencias.push(`CODIGO POSTAL "${postal}" no tiene 6 dígitos.`);
    Object.assign(address, { DepartmentCode: dep, CityCode: ciudad });
    if (postal) address.PostalCode = postal;
  } else {
    // Orden: columnas del Excel -> capital del país (src/dominio/capitales.js).
    const capital = CAPITALES[pais] || {};
    let ciudad = texto(d.municipio);
    let dep = texto(d.departamento);
    if ((!ciudad || !dep) && capital.ciudad) {
      ciudad = ciudad || capital.ciudad;
      dep = dep || capital.departamento;
      advertencias.push(`Proveedor no residente ${identificacion}: se usó la capital del país (${ciudad}, ${dep}) porque el Excel no trae la ciudad.`);
    }
    if (!ciudad || !dep) {
      errores.push(`Proveedor no residente ${identificacion}: el código de PAIS "${pais || '(vacío)'}" no es un país válido; corrígelo en el Excel.`);
    }
    Object.assign(address, { DepartmentName: dep, CityName: ciudad });
    const postal = texto(d.codigoPostal);
    if (postal) address.PostalCode = postal;
  }

  const identification = { DocumentNumber: identificacion, DocumentType: tipoSaphety || tipoDian, CountryCode: pais };
  if (esNit) identification.CheckDigit = calcularDV(identificacion);

  const supplier = {
    LegalType: legalType,
    Email: email,
    TaxScheme: texto(d.obligacionesImpuesto) || 'ZZ',
    ResponsabilityTypes: texto(d.obligacionesFiscales) ? texto(d.obligacionesFiscales).split(/[;,]/).map((s) => s.trim()).filter(Boolean) : ['R-99-PN'],
    Identification: identification,
    Name: nombreProveedor,
    Address: address,
  };
  if (legalType === 'Natural' && texto(d.nombre)) {
    supplier.Person = { FirstName: texto(d.nombre), FamilyName: texto(d.apellidos) };
    if (texto(d.segundoNombre)) supplier.Person.MiddleName = texto(d.segundoNombre);
  }
  const telefono = texto(d.telefono).replace(/\.0+$/, '');
  if (cfg.incluirTelefono && telefono && telefono !== '0') supplier.Telephone = telefono;

  // --- Líneas (una por fila)
  const retenciones = [];
  const ivas = []; // { porcentaje, base, valor }
  const fechasItem = [];
  const lineas = filas.map((f, i) => {
    const pre = filas.length > 1 ? `Línea ${i + 1}: ` : '';
    const valor = numero(f.valor);
    if (valor === null) errores.push(`${pre}VALOR_TOTAL ITEM vacío o no numérico.`);
    else if (valor <= 0) errores.push(`${pre}VALOR_TOTAL ITEM debe ser mayor que cero.`);
    const monto = valor || 0;

    const concepto = texto(f.conceptoLinea) || '1';
    if (!['1', '2'].includes(concepto)) errores.push(`${pre}CONCEPTO LINEA "${concepto}" debe ser 1 (por operación) o 2 (acumulado).`);
    const fechaItem = texto(f.fechaItem);
    // Regla DSFC02b: con "por operación" (1) la fecha del periodo debe ser la de emisión.
    const desde = concepto === '2' && fechaItem ? fechaItem : fechaEmision;
    // Si FECHA_ITEM es distinta, se conserva en las notas del documento.
    if (fechaItem && fechaItem !== desde && !fechasItem.includes(fechaItem)) fechasItem.push(fechaItem);

    const linea = {
      Number: String(i + 1),
      Quantity: '1.00',
      QuantityUnitOfMeasure: cfg.unidadMedida,
      UnitPrice: dinero(monto),
      GrossAmount: dinero(monto),
      NetAmount: dinero(monto),
      Item: { Description: texto(f.descripcion) },
      InvoicePeriod: { From: desde, DescriptionCode: concepto },
    };
    if (!texto(f.descripcion)) errores.push(`${pre}Falta la DESCRIPCION.`);
    if (texto(f.codigoProducto)) linea.Item.Gtin = texto(f.codigoProducto);

    // --- IVA: columna opcional "excluido iva" (SI) o "tasa iva" (19, 0.19); sin ellas, IVA 0 % según configuración.
    const excluido = /^(si|sí|s|x|1|true|verdadero)$/i.test(texto(f.excluidoIva));
    let tasaIva = numero(f.tasaIva);
    if (tasaIva !== null && tasaIva > 0 && tasaIva < 1) tasaIva *= 100;
    if (excluido && tasaIva) errores.push(`${pre}la línea no puede estar excluida de IVA y tener tasa de IVA.`);
    if (excluido) {
      linea.ExcludeVat = 'true';
    } else if (tasaIva || cfg.incluirIvaCero) {
      const porcentaje = tasaIva || 0;
      const valorIva = Math.round(((monto * porcentaje) / 100 + Number.EPSILON) * 100) / 100;
      linea.TaxSubTotals = [{ TaxCategory: '01', TaxPercentage: porcentaje.toFixed(2), TaxableAmount: dinero(monto), TaxAmount: dinero(valorIva) }];
      linea.TaxTotals = [{ TaxCategory: '01', TaxAmount: dinero(valorIva), RoundingAmount: '0.00' }];
      ivas.push({ porcentaje, base: monto, valor: valorIva });
    }

    // --- Retenciones (05 ReteIVA, 06 ReteRenta)
    const propias = [];
    const agregarRetencion = (categoria, nombre, base, tasa, valorRet) => {
      base = numero(base); tasa = numero(tasa); valorRet = numero(valorRet);
      if (base === null && tasa === null && valorRet === null) return;
      if (base === null || (valorRet === null && tasa === null)) {
        errores.push(`${pre}${nombre}: faltan base y valor (o tasa).`);
        return;
      }
      // Porcentaje: preferimos valor/base porque la tasa del Excel puede venir como 0.035 o 3.5.
      let porcentaje = valorRet !== null && base ? (valorRet / base) * 100 : (tasa <= 1 ? tasa * 100 : tasa);
      if (valorRet === null) valorRet = (base * porcentaje) / 100;
      if (tasa !== null && valorRet !== null) {
        const esperado1 = base * tasa;
        const esperado2 = (base * tasa) / 100;
        if (Math.abs(esperado1 - valorRet) > 1 && Math.abs(esperado2 - valorRet) > 1) {
          advertencias.push(`${pre}${nombre}: valor ${dinero(valorRet)} no cuadra con base × tasa.`);
        }
      }
      propias.push({ categoria, porcentaje, base, valor: valorRet });
    };
    agregarRetencion('05', 'ReteIVA', f.baseReteIva, f.tasaReteIva, f.valorReteIva);
    agregarRetencion('06', 'ReteFuente', f.baseReteFuente, f.tasaReteFuente, f.valorReteFuente);
    if (propias.length) {
      linea.WithholdingTaxSubTotals = propias.map((r) => ({
        WithholdingTaxCategory: r.categoria,
        TaxPercentage: r.porcentaje.toFixed(2),
        TaxableAmount: dinero(r.base),
        TaxAmount: dinero(r.valor),
      }));
      linea.WithholdingTaxTotals = propias.map((r) => ({ WithholdingTaxCategory: r.categoria, TaxAmount: dinero(r.valor) }));
      retenciones.push(...propias);
    }
    return { linea, monto };
  });
  // Regla DSFC02b: por operación, la fecha de la línea debe ser la de la firma (hoy).
  if (lineas.some((l) => l.linea.InvoicePeriod.DescriptionCode === '1' && l.linea.InvoicePeriod.From !== ahora.fecha)) {
    advertencias.push(`Fecha de emisión ${fechaEmision} distinta de hoy (${ahora.fecha}): la DIAN rechaza compras "por operación" con fecha anterior (regla DSFC02b). Usa fecha de emisión «hoy» en Administración.`);
  }
  if (retenciones.some((r) => r.categoria === '05') && !ivas.some((v) => v.valor > 0)) {
    advertencias.push('ReteIVA informado pero el documento no tiene IVA; para ReteIVA la base es el valor del IVA.');
  }

  // Totales del documento: impuestos y retenciones agrupados por categoría y porcentaje.
  const agrupar = (lista, clave) => {
    const m = new Map();
    for (const x of lista) {
      const k = clave(x);
      const g = m.get(k) || { ...x, base: 0, valor: 0 };
      g.base += x.base; g.valor += x.valor;
      m.set(k, g);
    }
    return [...m.values()];
  };
  const bruto = lineas.reduce((a, l) => a + l.monto, 0);
  const totalIva = ivas.reduce((a, v) => a + v.valor, 0);
  const baseIva = ivas.reduce((a, v) => a + v.base, 0);
  const ivaAgrupado = agrupar(ivas, (v) => v.porcentaje.toFixed(2));
  const retAgrupadas = agrupar(retenciones, (r) => `${r.categoria}|${r.porcentaje.toFixed(2)}`);

  // --- Notas
  const notas = [];
  if (texto(d.numOrden)) notas.push(`Orden de compra: ${texto(d.numOrden)}`);
  if (texto(d.observacion) && texto(d.observacion) !== texto(d.numOrden)) notas.push(`Observación: ${texto(d.observacion)}`);
  if (fechasItem.length) notas.push(`Fecha del servicio: ${fechasItem.join(', ')}`);

  // --- Documento
  const json = {
    Currency: moneda,
    SeriePrefix: num.prefijo,
    SerieNumber: num.numero,
    IssueDate: issueDate,
    DueDate: issueDate,
    DeliveryDate: issueDate,
    OperationType: residente ? '10' : '11',
    CorrelationDocumentId: `${num.prefijo}${num.numero}`.slice(0, 36),
    SerieExternalKey: cfg.serieExternalKeyDS,
    PaymentMeans: [{ Code: String(cfg.medioPagoCodigo), Mean: String(cfg.medioPagoForma), DueDate: fechaEmision }],
    CustomerParty: {
      Identification: {
        DocumentNumber: String(cfg.nit),
        DocumentType: 'NIT',
        CountryCode: 'CO',
        CheckDigit: String(cfg.digitoVerificacion || calcularDV(cfg.nit)),
      },
    },
    SupplierParty: supplier,
    Lines: lineas.map((l) => l.linea),
    Total: {
      GrossAmount: dinero(bruto),
      TotalBillableAmount: dinero(bruto + totalIva),
      PayableAmount: dinero(bruto + totalIva),
      TaxableAmount: dinero(baseIva),
    },
  };
  if (cfg.digitoVerificacion && cfg.nit && String(cfg.digitoVerificacion) !== calcularDV(cfg.nit)) {
    errores.push(`El dígito de verificación configurado (${cfg.digitoVerificacion}) no corresponde al NIT ${cfg.nit} (debería ser ${calcularDV(cfg.nit)}).`);
  }
  if (ivas.length) {
    json.TaxSubTotals = ivaAgrupado.map((v) => ({ TaxCategory: '01', TaxPercentage: v.porcentaje.toFixed(2), TaxableAmount: dinero(v.base), TaxAmount: dinero(v.valor) }));
    json.TaxTotals = [{ TaxCategory: '01', TaxAmount: dinero(totalIva), RoundingAmount: '0.00' }];
  }
  if (retAgrupadas.length) {
    json.WithholdingTaxSubTotals = retAgrupadas.map((r) => ({
      WithholdingTaxCategory: r.categoria,
      TaxPercentage: r.porcentaje.toFixed(2),
      TaxableAmount: dinero(r.base),
      TaxAmount: dinero(r.valor),
    }));
    const porCategoria = agrupar(retenciones, (r) => r.categoria);
    json.WithholdingTaxTotals = porCategoria.map((r) => ({ WithholdingTaxCategory: r.categoria, TaxAmount: dinero(r.valor) }));
  }
  if (notas.length) json.Notes = [notas.join(' | ').slice(0, 560)];

  if (moneda !== 'COP') {
    const trm = numero(d.valorTrm);
    const fechaTrm = texto(d.fechaTrm);
    if (!trm || !fechaTrm) errores.push(`Moneda ${moneda} requiere valor_trm y fecha_trm.`);
    else json.PaymentExchangeRate = { OriginCurrency: moneda, DestinyCurrency: 'COP', Rate: dinero(trm), Date: fechaTrm };
  }

  return {
    json,
    errores,
    advertencias,
    resumen: {
      numero: `${num.prefijo}${num.numero}`,
      proveedor: nombreProveedor,
      identificacion,
      valor: bruto + totalIva,
      lineas: filas.length,
      moneda,
      fecha: fechaEmision,
      residente,
    },
  };
}

module.exports = { construirDocumento, calcularDV, numeracionExcel, ahoraBogota };
