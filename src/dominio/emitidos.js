'use strict';
// Reglas para consultar en Saphety los documentos soporte emitidos: filtros de búsqueda,
// estados y la forma en que se muestran. Sin HTTP ni base de datos.
const { fallo } = require('./errores');

const TIPOS_DOCUMENTO = ['SupportDocument', 'SupportDocumentAdjustment'];
const NOMBRE_TIPO = { SupportDocument: 'Documento soporte', SupportDocumentAdjustment: 'Nota de ajuste' };
const TAMANO_PAGINA = 50;
const DIAS_POR_DEFECTO = 30;
const DIAS_MAXIMOS = 366;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const soloDigitos = (v) => String(v || '').replace(/\D/g, '');
const codigoCompania = (nit) => `CO_NIT_${soloDigitos(nit)}`;

/** Fecha de hoy en Colombia (YYYY-MM-DD). */
const hoyBogota = (ahora = new Date()) => new Date(ahora.getTime() - 5 * 3600e3).toISOString().slice(0, 10);
const sumarDias = (fecha, dias) => new Date(Date.parse(`${fecha}T00:00:00Z`) + dias * 86400e3).toISOString().slice(0, 10);

/**
 * Convierte los filtros de la pantalla en el cuerpo de outbounddocuments/search.
 * Solo trae documentos soporte (y notas de ajuste) en los que la compañía es el adquiriente.
 */
/** Valida el rango de fechas (AAAA-MM-DD, Colombia) y lo convierte a las fechas UTC que espera Saphety. */
function rangoFechas(desde, hasta, ahora = new Date()) {
  const fin = hasta || hoyBogota(ahora);
  const inicio = desde || sumarDias(fin, -DIAS_POR_DEFECTO);
  if (!FECHA.test(inicio) || !FECHA.test(fin)) throw fallo(400, 'Las fechas deben tener el formato AAAA-MM-DD.');
  if (inicio > fin) throw fallo(400, 'La fecha inicial es posterior a la final.');
  if (sumarDias(inicio, DIAS_MAXIMOS) < fin) throw fallo(400, `Consulta como máximo ${DIAS_MAXIMOS} días.`);
  return {
    desde: inicio,
    hasta: fin,
    // Las fechas de la pantalla son de Colombia (UTC-5).
    CreationDateStart: new Date(`${inicio}T00:00:00-05:00`).toISOString(),
    CreationDateEnd: new Date(`${fin}T23:59:59.999-05:00`).toISOString(),
  };
}

const numeroPagina = (pagina) => Math.max(Number.parseInt(pagina, 10) || 0, 0);

/**
 * Convierte los filtros de la pantalla en el cuerpo de outbounddocuments/search.
 * Solo trae documentos soporte (y notas de ajuste) en los que la compañía es el adquiriente.
 */
function filtroBusqueda({ desde, hasta, numero, pagina } = {}, nit, ahora = new Date()) {
  const r = rangoFechas(desde, hasta, ahora);
  const p = numeroPagina(pagina);
  const cuerpo = {
    DocumentTypes: TIPOS_DOCUMENTO,
    CustomerCodes: [codigoCompania(nit)],
    CreationDateStart: r.CreationDateStart,
    CreationDateEnd: r.CreationDateEnd,
    Offset: p,
    NumberOfRecords: TAMANO_PAGINA,
  };
  const n = String(numero || '').trim().toUpperCase();
  if (n) cuerpo.DocumentNumber = n;
  return { cuerpo, pagina: p, desde: r.desde, hasta: r.hasta };
}

/** Total de la búsqueda: el conteo si llegó; si no, el Total que trae la búsqueda. */
const totalBusqueda = (conteo, resultData) => (typeof conteo === 'number' ? conteo
  : resultData && typeof resultData.Total === 'number' ? resultData.Total : null);

/** Estado de Saphety/DIAN -> estado de la app (aceptado, rechazado o en proceso). */
function estadoApp(estadoSaphety) {
  const s = String(estadoSaphety || '').toLowerCase();
  if (s === 'certified' || s === 'accepted') return 'aceptado';
  if (/reject|refus|error|fail|invalid/.test(s)) return 'rechazado';
  return 'en_proceso';
}

/** La lista de documentos puede venir directamente en ResultData o dentro de un objeto. */
function listaDocumentos(resultData) {
  if (Array.isArray(resultData)) return resultData;
  if (resultData && typeof resultData === 'object') {
    const lista = ['Items', 'Documents', 'Results', 'Data', 'Records'].map((k) => resultData[k]).find(Array.isArray);
    if (lista) return lista;
  }
  return [];
}

/** Datos básicos de un documento tal como los devuelve Saphety, con nombres de la app. */
function resumenEmitido(d) {
  return {
    id: d.Id,
    tipo: NOMBRE_TIPO[d.DocumentType] || d.DocumentType || '',
    numero: d.DocumentNumber || '',
    proveedor: d.OriginName || '',
    proveedorCodigo: d.OriginCode || '',
    compania: d.DestinationName || '',
    companiaCodigo: d.DestinationCode || '',
    fechaDocumento: d.DocumentDate || null,
    fechaCreacion: d.CreationDate || null,
    estado: estadoApp(d.DocumentStatus),
    estadoSaphety: d.DocumentStatus || '',
    estadoFecha: d.DocumentStatusDate || null,
    motivo: [d.DocumentStatusReasonCode, d.DocumentStatusReason].filter(Boolean).join(': '),
    moneda: d.Currency || 'COP',
    valor: d.TotalAmount ?? null,
    cuds: d.Cufe || d.Cuds || null,
    correo: d.MainEmailNotification || '',
    correoEstado: d.MainEmailNotificationStatus || '',
    pdfGenerado: d.IsPdfGenerated !== false,
  };
}

/** El documento pertenece a la compañía si ella es el adquiriente (o, por si acaso, el emisor). */
const perteneceA = (d, nit) => [d.DestinationCode, d.OriginCode].some((c) => soloDigitos(String(c || '').split('_').pop()) === soloDigitos(nit));

/** Líneas del documento a partir del DTO (el JSON que Saphety guardó del documento). */
function lineasDto(dto) {
  const lineas = dto && (dto.Lines || (dto.Document && dto.Document.Lines));
  if (!Array.isArray(lineas)) return [];
  return lineas.map((l, i) => ({
    numero: l.Number || i + 1,
    descripcion: (l.Item && l.Item.Description) || l.Description || '',
    cantidad: l.Quantity ?? null,
    precio: l.UnitPrice ?? null,
    valor: l.GrossAmount ?? l.NetAmount ?? l.LineExtensionAmount ?? null,
    iva: Array.isArray(l.TaxTotals) ? l.TaxTotals.reduce((s, t) => s + (Number(t.TaxAmount) || 0), 0) : null,
  }));
}

const FORMATOS = {
  pdf: { ruta: 'pdf', tipo: 'application/pdf', extension: 'pdf' },
  xml: { ruta: 'ubl', tipo: 'application/xml', extension: 'xml' },
  attached: { ruta: 'attacheddocument', tipo: 'application/xml', extension: 'attached.xml' },
};

function validarId(id) {
  if (!UUID.test(String(id || ''))) throw fallo(400, 'Identificador de documento inválido.');
  return String(id);
}

module.exports = {
  TIPOS_DOCUMENTO, TAMANO_PAGINA, FORMATOS, filtroBusqueda, estadoApp, listaDocumentos, resumenEmitido, perteneceA, lineasDto,
  validarId, codigoCompania, hoyBogota, rangoFechas, numeroPagina, totalBusqueda, soloDigitos,
};
