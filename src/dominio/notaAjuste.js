'use strict';
// Nota de ajuste al documento soporte (POST /v2/{opv}/outbounddocuments/supportDocumentAdjust).
// Se arma a partir del JSON del documento soporte original: mismo proveedor y adquiriente, las líneas
// que se ajustan con su nuevo valor, y la referencia (número, fecha y CUDS) al documento original.
// Sin HTTP ni base de datos.
const { fallo } = require('./errores');
const { conDefaults } = require('../config/parametros');
const { ahoraBogota } = require('./mapper');

// Conceptos de corrección de la DIAN (catálogo creditnotereasons de Saphety). Se usan si el catálogo no responde.
const CONCEPTOS = [
  { codigo: '1', nombre: 'Devolución parcial de los bienes y/o no aceptación parcial del servicio' },
  { codigo: '2', nombre: 'Anulación del documento soporte' },
  { codigo: '3', nombre: 'Rebaja o descuento parcial o total' },
  { codigo: '4', nombre: 'Ajuste de precio' },
  { codigo: '5', nombre: 'Otros' },
];
const MAX_NOTAS = 560;

const texto = (v) => (v === null || v === undefined ? '' : String(v).trim());
const num = (v) => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};
const redondear = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const dinero = (n) => redondear(n).toFixed(2);
const copia = (o) => JSON.parse(JSON.stringify(o));

/** El DTO de Saphety puede traer el documento en la raíz o dentro de "Document". */
function documentoOriginal(json) {
  const d = json && (json.SupplierParty ? json : json.Document);
  return d && d.SupplierParty && Array.isArray(d.Lines) && d.Lines.length ? d : null;
}

const valorLinea = (l) => num(l.GrossAmount) ?? num(l.NetAmount) ?? num(l.LineExtensionAmount) ?? 0;
const ivaLinea = (l) => (Array.isArray(l.TaxTotals) ? l.TaxTotals.reduce((s, t) => s + (num(t.TaxAmount) || 0), 0) : 0);

/** Lo que la pantalla necesita para elegir qué ajustar. */
function resumenOriginal(original) {
  return {
    proveedor: texto(original.SupplierParty.Name),
    identificacion: texto(original.SupplierParty.Identification && original.SupplierParty.Identification.DocumentNumber),
    moneda: texto(original.Currency) || 'COP',
    lineas: original.Lines.map((l, i) => ({
      numero: texto(l.Number) || String(i + 1),
      descripcion: texto(l.Item && l.Item.Description),
      valor: valorLinea(l),
      iva: ivaLinea(l),
      ivaPorcentaje: Array.isArray(l.TaxSubTotals) && l.TaxSubTotals[0] ? num(l.TaxSubTotals[0].TaxPercentage) : null,
    })),
  };
}

/** Línea de la nota: la original con el nuevo valor; IVA y retenciones se recalculan en proporción. */
function lineaAjustada(original, valor, numeroLinea, hoy) {
  const l = copia(original);
  const anterior = valorLinea(original);
  const factor = anterior ? valor / anterior : 0;
  if (Math.abs(valor - anterior) > 0.005) {
    l.Quantity = '1.00';
    l.UnitPrice = dinero(valor);
  }
  l.Number = String(numeroLinea);
  l.GrossAmount = dinero(valor);
  l.NetAmount = dinero(valor);
  delete l.LineExtensionAmount;
  // Regla DSFC02b: con periodo "por operación" la fecha del periodo es la de emisión.
  l.InvoicePeriod = { From: hoy, DescriptionCode: '1' };
  if (Array.isArray(l.TaxSubTotals)) {
    l.TaxSubTotals = l.TaxSubTotals.map((t) => {
      const pct = num(t.TaxPercentage) || 0;
      return { ...t, TaxableAmount: dinero(valor), TaxAmount: dinero((valor * pct) / 100) };
    });
    const iva = l.TaxSubTotals.reduce((s, t) => s + Number(t.TaxAmount), 0);
    l.TaxTotals = [{ TaxCategory: '01', TaxAmount: dinero(iva), RoundingAmount: '0.00' }];
  }
  if (Array.isArray(l.WithholdingTaxSubTotals)) {
    l.WithholdingTaxSubTotals = l.WithholdingTaxSubTotals.map((r) => ({
      ...r, TaxableAmount: dinero((num(r.TaxableAmount) || 0) * factor), TaxAmount: dinero((num(r.TaxAmount) || 0) * factor),
    }));
    const porCategoria = new Map();
    for (const r of l.WithholdingTaxSubTotals) porCategoria.set(r.WithholdingTaxCategory, (porCategoria.get(r.WithholdingTaxCategory) || 0) + Number(r.TaxAmount));
    l.WithholdingTaxTotals = [...porCategoria].map(([c, v]) => ({ WithholdingTaxCategory: c, TaxAmount: dinero(v) }));
  }
  return l;
}

/** Totales del documento a partir de sus líneas (IVA y retenciones agrupados). */
function totales(lineas) {
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
  const ivas = lineas.flatMap((l) => (l.TaxSubTotals || []).map((t) => ({ pct: num(t.TaxPercentage) || 0, base: num(t.TaxableAmount) || 0, valor: num(t.TaxAmount) || 0 })));
  const rets = lineas.flatMap((l) => (l.WithholdingTaxSubTotals || []).map((r) => ({
    categoria: r.WithholdingTaxCategory, pct: num(r.TaxPercentage) || 0, base: num(r.TaxableAmount) || 0, valor: num(r.TaxAmount) || 0,
  })));
  const bruto = lineas.reduce((s, l) => s + Number(l.GrossAmount), 0);
  const totalIva = ivas.reduce((s, v) => s + v.valor, 0);
  const r = {
    Total: {
      GrossAmount: dinero(bruto),
      TotalBillableAmount: dinero(bruto + totalIva),
      PayableAmount: dinero(bruto + totalIva),
      TaxableAmount: dinero(ivas.reduce((s, v) => s + v.base, 0)),
    },
  };
  if (ivas.length) {
    r.TaxSubTotals = agrupar(ivas, (v) => v.pct.toFixed(2)).map((v) => ({ TaxCategory: '01', TaxPercentage: v.pct.toFixed(2), TaxableAmount: dinero(v.base), TaxAmount: dinero(v.valor) }));
    r.TaxTotals = [{ TaxCategory: '01', TaxAmount: dinero(totalIva), RoundingAmount: '0.00' }];
  }
  if (rets.length) {
    r.WithholdingTaxSubTotals = agrupar(rets, (x) => `${x.categoria}|${x.pct.toFixed(2)}`)
      .map((x) => ({ WithholdingTaxCategory: x.categoria, TaxPercentage: x.pct.toFixed(2), TaxableAmount: dinero(x.base), TaxAmount: dinero(x.valor) }));
    r.WithholdingTaxTotals = agrupar(rets, (x) => x.categoria).map((x) => ({ WithholdingTaxCategory: x.categoria, TaxAmount: dinero(x.valor) }));
  }
  return { ...r, valor: bruto + totalIva };
}

/**
 * @param {object} original  JSON del documento soporte original (el enviado a Saphety o su DTO)
 * @param {object} referencia  { numero, fecha, cuds } del documento original, según Saphety
 * @param {object} pedido  { concepto, motivo, lineas: [{ numero, valor }] }
 * @param {object} configuracion  parámetros de la compañía
 * @param {object} opciones  { numeracion: { prefijo, numero }, ahora }
 */
function construirNotaAjuste(original, referencia, pedido, configuracion, opciones = {}) {
  const cfg = conDefaults(configuracion);
  const errores = [];
  const p = pedido || {};

  const concepto = texto(p.concepto);
  if (!concepto) errores.push('Elige el concepto de la nota de ajuste.');
  const motivo = texto(p.motivo);
  if (!motivo) errores.push('Escribe el motivo de la nota de ajuste.');
  else if (motivo.length > MAX_NOTAS) errores.push(`El motivo admite hasta ${MAX_NOTAS} caracteres.`);
  if (!cfg.serieExternalKeyNotaAjuste) errores.push('Configura la SerieExternalKey de notas de ajuste en Administración.');
  if (!referencia || !texto(referencia.numero) || !texto(referencia.cuds)) errores.push('El documento soporte original no tiene número o CUDS en Saphety.');

  const hoy = ahoraBogota(opciones.ahora);
  const porNumero = new Map(original.Lines.map((l, i) => [texto(l.Number) || String(i + 1), l]));
  const pedidas = Array.isArray(p.lineas) ? p.lineas : [];
  if (!pedidas.length) errores.push('Elige al menos una línea para ajustar.');
  const lineas = [];
  for (const x of pedidas) {
    const l = porNumero.get(texto(x.numero));
    if (!l) { errores.push(`La línea ${texto(x.numero)} no existe en el documento original.`); continue; }
    const valor = num(x.valor);
    const tope = valorLinea(l);
    if (valor === null || valor <= 0) errores.push(`Línea ${texto(x.numero)}: el valor a ajustar debe ser mayor que cero.`);
    else if (valor > tope + 0.005) errores.push(`Línea ${texto(x.numero)}: el valor a ajustar (${dinero(valor)}) supera el valor original (${dinero(tope)}).`);
    else lineas.push(lineaAjustada(l, redondear(valor), lineas.length + 1, hoy.fecha));
  }

  const n = opciones.numeracion || { prefijo: cfg.prefijoNotaAjuste, numero: String(cfg.siguienteNotaAjuste) };
  if (!texto(n.prefijo) || !/^\d+$/.test(texto(n.numero))) errores.push('Configura el prefijo y el siguiente número de notas de ajuste en Administración.');
  const t = totales(lineas);
  const issueDate = `${hoy.fecha}T${hoy.hora}`;
  const json = {
    Currency: texto(original.Currency) || 'COP',
    ReasonCredit: concepto,
    SeriePrefix: texto(n.prefijo),
    SerieNumber: texto(n.numero),
    IssueDate: issueDate,
    DueDate: issueDate,
    DeliveryDate: issueDate,
    OperationType: texto(original.OperationType) || '10',
    CorrelationDocumentId: `${texto(n.prefijo)}${texto(n.numero)}`.slice(0, 36),
    SerieExternalKey: cfg.serieExternalKeyNotaAjuste,
    PaymentMeans: (Array.isArray(original.PaymentMeans) && original.PaymentMeans.length ? original.PaymentMeans : [{ Code: String(cfg.medioPagoCodigo), Mean: String(cfg.medioPagoForma) }])
      .map((m) => ({ ...m, DueDate: hoy.fecha })),
    CustomerParty: copia(original.CustomerParty),
    SupplierParty: copia(original.SupplierParty),
    Lines: lineas,
    ...(({ valor, ...resto }) => resto)(t), // eslint-disable-line no-unused-vars
    DocumentReferences: [{
      DocumentReferred: texto(referencia && referencia.numero),
      IssueDate: texto(referencia && referencia.fecha).slice(0, 19),
      Type: 'InvoiceReference',
      DocumentReferredCUFE: texto(referencia && referencia.cuds),
    }],
    Notes: [motivo.slice(0, MAX_NOTAS)],
  };
  if (original.PaymentExchangeRate) json.PaymentExchangeRate = copia(original.PaymentExchangeRate);

  return {
    json,
    errores,
    resumen: {
      numero: `${json.SeriePrefix}${json.SerieNumber}`,
      referencia: texto(referencia && referencia.numero),
      proveedor: texto(original.SupplierParty.Name),
      identificacion: texto(original.SupplierParty.Identification && original.SupplierParty.Identification.DocumentNumber),
      valor: t.valor,
    },
  };
}

/** Concepto válido según el catálogo (o la lista de la DIAN si el catálogo no llegó). */
function conceptos(catalogo) {
  const lista = Array.isArray(catalogo) ? catalogo : catalogo && Array.isArray(catalogo.ResultData) ? catalogo.ResultData : null;
  if (!lista || !lista.length) return CONCEPTOS;
  const r = lista.map((c) => ({ codigo: texto(c.Code ?? c.Id ?? c.Value), nombre: texto(c.Description ?? c.Name ?? c.Value) })).filter((c) => c.codigo);
  return r.length ? r : CONCEPTOS;
}

function exigirOriginal(json) {
  const d = documentoOriginal(json);
  if (!d) throw fallo(422, 'No se encontraron los datos del documento soporte original (proveedor y líneas) para armar la nota de ajuste.');
  return d;
}

module.exports = { CONCEPTOS, MAX_NOTAS, documentoOriginal, exigirOriginal, resumenOriginal, construirNotaAjuste, conceptos };
