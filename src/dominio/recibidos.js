'use strict';
// Reglas del buzón de recepción: filtros de búsqueda, estados y qué evento RADIAN corresponde en cada estado.
const { fallo } = require('./errores');
const { TAMANO_PAGINA, rangoFechas, numeroPagina, soloDigitos, codigoCompania } = require('./emitidos');

const TIPOS_DOCUMENTO = ['SalesInvoice', 'CreditNote', 'DebitNote'];
const NOMBRE_TIPO = { SalesInvoice: 'Factura', CreditNote: 'Nota crédito', DebitNote: 'Nota débito' };

// Estado de Saphety -> clase de la app (color) y texto.
const ESTADOS = {
  Registered: { clase: 'pendiente', texto: 'Recibido en buzón' },
  Received: { clase: 'en_proceso', texto: 'Acuse de recibo' },
  GoodsOrServicesReceived: { clase: 'en_proceso', texto: 'Bien o servicio recibido' },
  Accepted: { clase: 'aceptado', texto: 'Aceptado' },
  TacitlyAccepted: { clase: 'aceptado', texto: 'Aceptado tácitamente' },
  Rejected: { clase: 'rechazado', texto: 'Reclamado (rechazado)' },
};

// Eventos RADIAN en el orden de la DIAN: 030 acuse -> 032 recibo del bien -> 033 aceptación o 031 reclamo.
const EVENTOS = {
  acuse: { codigo: '030', nombre: 'Acuse de recibo', desde: ['Registered'], conPersona: true },
  reciboBien: { codigo: '032', nombre: 'Recibo del bien o prestación del servicio', desde: ['Received'], conPersona: true },
  aceptar: { codigo: '033', nombre: 'Aceptación expresa', desde: ['GoodsOrServicesReceived'] },
  rechazar: { codigo: '031', nombre: 'Reclamo (rechazo)', desde: ['GoodsOrServicesReceived'] },
};

// Conceptos de reclamo de la DIAN (evento 031).
const CONCEPTOS_RECLAMO = {
  '01': 'Documento con inconsistencias',
  '02': 'Mercancía no entregada totalmente',
  '03': 'Mercancía no entregada parcialmente',
  '04': 'Servicio no prestado',
};

const ESTADO_FILTRO = { pendientes: ['Registered', 'Received', 'GoodsOrServicesReceived'], aceptados: ['Accepted', 'TacitlyAccepted'], rechazados: ['Rejected'] };

/**
 * Cuerpo de inbounddocuments/search: documentos en los que la compañía es el adquiriente,
 * o todos los de la cuenta de Saphety si cuenta = true (solo el administrador).
 */
function filtroBusqueda({ desde, hasta, numero, proveedor, estado, pagina } = {}, cfg, ahora = new Date(), { cuenta = false } = {}) {
  const r = rangoFechas(desde, hasta, ahora);
  const p = numeroPagina(pagina);
  const cuerpo = {
    DocumentTypes: TIPOS_DOCUMENTO,
    CreationDateStart: r.CreationDateStart,
    CreationDateEnd: r.CreationDateEnd,
    Offset: p,
    NumberOfRecords: TAMANO_PAGINA,
  };
  if (cfg.companyId && !cuenta) cuerpo.CompanyIds = [cfg.companyId];
  const n = String(numero || '').trim().toUpperCase();
  if (n) cuerpo.DocumentNumber = n;
  const nitProveedor = soloDigitos(proveedor);
  if (nitProveedor) cuerpo.SuppliersCodes = [codigoCompania(nitProveedor)];
  if (estado) {
    if (!ESTADO_FILTRO[estado]) throw fallo(400, 'Estado inválido.');
    cuerpo.DocumentStatus = ESTADO_FILTRO[estado];
  }
  return { cuerpo, pagina: p, desde: r.desde, hasta: r.hasta };
}

/** El documento es de la compañía si ella es el adquiriente (destino). */
const esAdquiriente = (d, nit) => soloDigitos(String(d.DestinationCode || '').split('_').pop()) === soloDigitos(nit);

/** Eventos que se pueden registrar en el estado actual. */
const eventosPermitidos = (estadoSaphety) => Object.keys(EVENTOS).filter((k) => EVENTOS[k].desde.includes(estadoSaphety));

function resumenRecibido(d) {
  const e = ESTADOS[d.DocumentStatus] || { clase: 'en_proceso', texto: d.DocumentStatus || 'Desconocido' };
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
    estado: e.clase,
    estadoTexto: e.texto,
    estadoSaphety: d.DocumentStatus || '',
    estadoFecha: d.DocumentStatusDate || null,
    motivo: [d.DocumentStatusReasonCode, d.DocumentStatusReason].filter(Boolean).join(': '),
    moneda: d.Currency || 'COP',
    valor: d.TotalAmount ?? null,
    base: d.TotalTaxableAmount ?? null,
    iva: d.VatTotalAmount ?? null,
    cufe: d.Cufe || null,
    firmaInvalida: !!d.DocumentInvalidSignature,
    eventos: eventosPermitidos(d.DocumentStatus),
  };
}

const texto = (v, max) => String(v ?? '').trim().slice(0, max);

/** Valida lo que llega de la pantalla para un evento y arma el cuerpo de Saphety. */
function datosEvento(tipo, { persona = {}, motivo, concepto } = {}) {
  const ev = EVENTOS[tipo];
  if (!ev) throw fallo(400, 'Evento inválido.');
  if (ev.conPersona) {
    const p = {
      FirstName: texto(persona.nombre, 100),
      FamilyName: texto(persona.apellido, 100),
      JobTitle: texto(persona.cargo, 100),
      OrganizationDepartment: texto(persona.area, 100),
      Identification: {
        DocumentNumber: soloDigitos(persona.documento),
        DocumentType: texto(persona.tipoDocumento || 'CC', 10),
        CountryCode: 'CO',
      },
    };
    if (!p.FirstName || !p.FamilyName || !p.Identification.DocumentNumber) {
      throw fallo(400, 'Para este evento indica nombre, apellido y documento de quien lo registra.');
    }
    if (persona.digitoVerificacion) p.Identification.CheckDigit = soloDigitos(persona.digitoVerificacion).slice(0, 1);
    return { ev, persona: p };
  }
  const m = texto(motivo, 500);
  if (tipo === 'rechazar') {
    if (!CONCEPTOS_RECLAMO[concepto]) throw fallo(400, 'Elige el concepto del reclamo.');
    return { ev, motivo: m || CONCEPTOS_RECLAMO[concepto], concepto };
  }
  return { ev, motivo: m || 'Aceptación expresa del documento' };
}

module.exports = {
  TIPOS_DOCUMENTO, EVENTOS, CONCEPTOS_RECLAMO, filtroBusqueda, esAdquiriente, eventosPermitidos, resumenRecibido, datosEvento,
};
