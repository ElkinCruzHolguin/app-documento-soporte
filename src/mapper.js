'use strict';
// Convierte una fila del Excel en el JSON de Documento Soporte de Saphety
// (POST /v2/{opv}/outbounddocuments/supportDocument) y valida la fila.

const { conDefaults } = require('./config');
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
 * @param {object} datos  fila del Excel (campos de excel.js)
 * @param {object} configuracion  parámetros del perfil activo
 * @param {object} opciones  { numeracion: {prefijo, numero} } para forzar la numeración (consecutivo)
 * @returns {{ json: object|null, errores: string[], advertencias: string[], resumen: object }}
 */
function construirDocumento(datos, configuracion, opciones = {}) {
  const cfg = conDefaults(configuracion);
  const d = datos;
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
  const fechaItem = texto(d.fechaItem);

  // --- Valores
  const valor = numero(d.valor);
  if (valor === null) errores.push('VALOR_TOTAL ITEM vacío o no numérico.');
  else if (valor <= 0) errores.push('VALOR_TOTAL ITEM debe ser mayor que cero.');

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
    if (postal && !/^\d{6}$/.test(postal)) advertencias.push(`CODIGO POSTAL "${postal}" no tiene 6 dígitos.`);
    Object.assign(address, { DepartmentCode: dep, CityCode: ciudad });
    if (postal) address.PostalCode = postal;
  } else {
    // Orden: columnas del Excel -> capital del país -> valor por defecto de Administración.
    const capital = CAPITALES[pais] || {};
    let ciudad = texto(d.municipio);
    let dep = texto(d.departamento);
    if ((!ciudad || !dep) && capital.ciudad) {
      ciudad = ciudad || capital.ciudad;
      dep = dep || capital.departamento;
      advertencias.push(`Proveedor no residente ${identificacion}: se usó la capital del país (${ciudad}, ${dep}) porque el Excel no trae la ciudad.`);
    }
    ciudad = ciudad || cfg.ciudadExtranjeroDefecto;
    dep = dep || cfg.departamentoExtranjeroDefecto;
    if (!ciudad || !dep) {
      errores.push(`Proveedor no residente ${identificacion}: falta ciudad o departamento/estado: el país ${pais || '(vacío)'} no tiene capital registrada (src/capitales.js) y no hay ciudad por defecto en Administración.`);
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

  // --- Línea
  const monto = valor || 0;
  const concepto = texto(d.conceptoLinea) || '1';
  if (!['1', '2'].includes(concepto)) errores.push(`CONCEPTO LINEA "${concepto}" debe ser 1 (por operación) o 2 (acumulado).`);
  // Regla DSFC02b: con "por operación" (1) la fecha del periodo debe ser la de emisión.
  const desde = concepto === '2' && fechaItem ? fechaItem : fechaEmision;
  // Si FECHA_ITEM es distinta, se conserva en las notas del documento.

  const descripcion = texto(d.descripcion);
  const linea = {
    Number: '1',
    Quantity: '1.00',
    QuantityUnitOfMeasure: cfg.unidadMedida,
    UnitPrice: dinero(monto),
    GrossAmount: dinero(monto),
    NetAmount: dinero(monto),
    Item: { Description: descripcion },
    InvoicePeriod: { From: desde, DescriptionCode: concepto },
  };
  if (texto(d.codigoProducto)) linea.Item.Gtin = texto(d.codigoProducto);
  if (cfg.incluirIvaCero) {
    linea.TaxSubTotals = [{ TaxCategory: '01', TaxPercentage: '0.00', TaxableAmount: dinero(monto), TaxAmount: '0.00' }];
    linea.TaxTotals = [{ TaxCategory: '01', TaxAmount: '0.00', RoundingAmount: '0.00' }];
  }

  // --- Retenciones (05 ReteIVA, 06 ReteRenta)
  const retenciones = [];
  const agregarRetencion = (categoria, nombre, base, tasa, valorRet) => {
    base = numero(base); tasa = numero(tasa); valorRet = numero(valorRet);
    if (base === null && tasa === null && valorRet === null) return;
    if (base === null || (valorRet === null && tasa === null)) {
      errores.push(`${nombre}: faltan base y valor (o tasa).`);
      return;
    }
    // Porcentaje: preferimos valor/base porque la tasa del Excel puede venir como 0.035 o 3.5.
    let porcentaje = valorRet !== null && base ? (valorRet / base) * 100 : (tasa <= 1 ? tasa * 100 : tasa);
    if (valorRet === null) valorRet = (base * porcentaje) / 100;
    if (tasa !== null && valorRet !== null) {
      const esperado1 = base * tasa;
      const esperado2 = (base * tasa) / 100;
      if (Math.abs(esperado1 - valorRet) > 1 && Math.abs(esperado2 - valorRet) > 1) {
        advertencias.push(`${nombre}: valor ${dinero(valorRet)} no cuadra con base × tasa.`);
      }
    }
    retenciones.push({ categoria, porcentaje, base, valor: valorRet });
  };
  agregarRetencion('05', 'ReteIVA', d.baseReteIva, d.tasaReteIva, d.valorReteIva);
  agregarRetencion('06', 'ReteFuente', d.baseReteFuente, d.tasaReteFuente, d.valorReteFuente);
  if (retenciones.some((r) => r.categoria === '05')) {
    advertencias.push('ReteIVA informado pero el documento no tiene IVA; para ReteIVA la base es el valor del IVA.');
  }
  if (retenciones.length) {
    const sub = retenciones.map((r) => ({
      WithholdingTaxCategory: r.categoria,
      TaxPercentage: r.porcentaje.toFixed(2),
      TaxableAmount: dinero(r.base),
      TaxAmount: dinero(r.valor),
    }));
    const tot = retenciones.map((r) => ({ WithholdingTaxCategory: r.categoria, TaxAmount: dinero(r.valor) }));
    linea.WithholdingTaxSubTotals = sub;
    linea.WithholdingTaxTotals = tot;
  }

  // --- Notas
  const notas = [];
  if (texto(d.numOrden)) notas.push(`Orden de compra: ${texto(d.numOrden)}`);
  if (texto(d.observacion) && texto(d.observacion) !== texto(d.numOrden)) notas.push(`Observación: ${texto(d.observacion)}`);
  if (fechaItem && fechaItem !== desde) notas.push(`Fecha del servicio: ${fechaItem}`);

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
    Lines: [linea],
    Total: {
      GrossAmount: dinero(monto),
      TotalBillableAmount: dinero(monto),
      PayableAmount: dinero(monto),
      TaxableAmount: cfg.incluirIvaCero ? dinero(monto) : '0.00',
    },
  };
  if (cfg.digitoVerificacion && cfg.nit && String(cfg.digitoVerificacion) !== calcularDV(cfg.nit)) {
    errores.push(`El dígito de verificación configurado (${cfg.digitoVerificacion}) no corresponde al NIT ${cfg.nit} (debería ser ${calcularDV(cfg.nit)}).`);
  }
  if (cfg.incluirIvaCero) {
    json.TaxSubTotals = [{ TaxCategory: '01', TaxPercentage: '0.00', TaxableAmount: dinero(monto), TaxAmount: '0.00' }];
    json.TaxTotals = [{ TaxCategory: '01', TaxAmount: '0.00', RoundingAmount: '0.00' }];
  }
  if (retenciones.length) {
    json.WithholdingTaxSubTotals = linea.WithholdingTaxSubTotals;
    json.WithholdingTaxTotals = linea.WithholdingTaxTotals;
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
      valor: monto,
      moneda,
      fecha: fechaEmision,
      residente,
    },
  };
}

module.exports = { construirDocumento, calcularDV, numeracionExcel, ahoraBogota };
