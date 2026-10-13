'use strict';
// Emisión de documentos en Saphety: documento soporte (lo que usa la app hoy) y, listos para las
// próximas funcionalidades, nota de ajuste, factura de venta, notas crédito/débito, nómina y POS.
const crypto = require('node:crypto');
const { base, pedirJson, obtenerToken, mensajeRespuesta, llamar, pedir } = require('./cliente');

// Tipo de documento -> rutas de creación (síncrona y asíncrona) bajo /v2/{opv}/.
const RUTAS_CREACION = {
  documentoSoporte: { sincrona: 'outbounddocuments/supportDocument', asincrona: 'outbounddocuments/supportDocumentAsync' },
  notaAjusteSoporte: { sincrona: 'outbounddocuments/supportDocumentAdjust', asincrona: 'outbounddocuments/supportDocumentAdjustAsync' },
  facturaVenta: { sincrona: 'outbounddocuments/salesInvoice', asincrona: 'outbounddocuments/salesInvoiceasync' },
  facturaContingencia: { asincrona: 'outbounddocuments/contingencyInvoiceAsync' },
  notaCredito: { sincrona: 'outbounddocuments/creditNote', asincrona: 'outbounddocuments/creditNoteAsync' },
  notaDebito: { sincrona: 'outbounddocuments/debitNote', asincrona: 'outbounddocuments/debitNoteAsync' },
  nomina: { asincrona: 'payroll/payrollAsync' },
  ajusteNomina: { asincrona: 'payroll/replacementPayrollAsync' },
  documentoEquivalentePos: { asincrona: 'outbounddocuments/posEquivalentDocumentAsync' },
};

/** Convierte la respuesta de creación en el resultado que guarda y muestra la app. */
function resultadoCreacion(status, datos) {
  datos = datos || {};
  const rd = datos.ResultData || {};
  const valido = status >= 200 && status < 300 && datos.IsValid !== false;
  return {
    estado: valido ? 'aceptado' : 'rechazado',
    respuesta: datos,
    saphetyId: rd.Id || null,
    cuds: rd.CUFE || rd.CUDS || rd.CUDE || rd.CUNE || null,
    mensaje: mensajeRespuesta(datos) || (valido ? 'Documento creado' : `HTTP ${status}`),
  };
}

async function crearDocumentoSoporte(perfilId, cfg, clave, documento) {
  const ruta = cfg.endpoint === 'async' ? 'supportDocumentAsync' : 'supportDocument';
  const url = `${base(cfg)}/v2/${encodeURIComponent(cfg.opv)}/outbounddocuments/${ruta}`;
  const enviar = async (token) => pedirJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(documento),
  });

  let r = await enviar(await obtenerToken(perfilId, cfg, clave));
  if (r.status === 401) {
    // Token vencido o revocado: se pide uno nuevo y se reintenta una vez.
    r = await enviar(await obtenerToken(perfilId, cfg, clave, { forzar: true }));
  }
  return resultadoCreacion(r.status, r.datos);
}

/** Crea cualquier otro tipo de documento de RUTAS_CREACION (asíncrono si existe, salvo que se pida síncrono). */
async function crearDocumento(perfilId, cfg, clave, tipo, documento, { sincrono = false } = {}) {
  const rutas = RUTAS_CREACION[tipo];
  if (!rutas) throw new Error(`Tipo de documento desconocido: ${tipo}`);
  const ruta = (sincrono && rutas.sincrona) || rutas.asincrona || rutas.sincrona;
  const r = await llamar(perfilId, cfg, clave, ruta, { metodo: 'POST', cuerpo: documento });
  return resultadoCreacion(r.status, r.datos);
}

/** Modo simulado: no sale nada a internet, devuelve una respuesta con la forma de Saphety. */
function simular(documento) {
  const id = crypto.randomUUID();
  return {
    estado: 'simulado',
    respuesta: {
      IsValid: true,
      Warnings: [],
      Errors: [],
      ResultData: { Id: id, CorrelationDocumentId: documento.CorrelationDocumentId, CUFE: '(simulado)' },
      ResultCode: 200,
      Simulado: true,
    },
    saphetyId: id,
    cuds: null,
    mensaje: 'Simulado: el JSON se generó pero no se envió a Saphety.',
  };
}

/** Calcula el código único (cuds, cufe, cude, equivalentDocumentCude) sin crear el documento. */
async function generarCodigo(perfilId, cfg, clave, tipo, datos) {
  const rutas = { cuds: 'outbounddocuments/cuds', cufe: 'outbounddocuments/cufe', cude: 'outbounddocuments/cude', cudePos: 'outbounddocuments/equivalentDocumentCude', cune: 'payroll/cune' };
  if (!rutas[tipo]) throw new Error(`Código desconocido: ${tipo}`);
  return pedir(perfilId, cfg, clave, rutas[tipo], 'generar el código', { metodo: 'POST', cuerpo: datos });
}

/** Reenvía por correo la notificación de un documento emitido. */
async function enviarCorreo(perfilId, cfg, clave, documentId, email, { tipo = 'documento' } = {}) {
  const rutas = { documento: 'outbounddocuments/sendemail', equivalente: 'outbounddocuments/sendemailequivalentdocument', nomina: 'payroll/sendemail' };
  return pedir(perfilId, cfg, clave, rutas[tipo] || rutas.documento, 'enviar el correo', { metodo: 'POST', cuerpo: { DocumentId: documentId, Email: email } });
}

module.exports = { RUTAS_CREACION, crearDocumentoSoporte, crearDocumento, simular, generarCodigo, enviarCorreo };
