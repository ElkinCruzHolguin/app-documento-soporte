'use strict';
// Documentos recibidos (inbounddocuments): buzón de facturas de proveedores y eventos RADIAN.
const { pedir, archivo, rutaDocumento } = require('./cliente');

const ruta = (id, extra) => rutaDocumento('inbounddocuments', id, extra);
const post = (cuerpo) => ({ metodo: 'POST', cuerpo });

module.exports = {
  /** Busca documentos recibidos (ResultData: { Items, Total }). */
  buscarRecibidos: (perfilId, cfg, clave, filtro) => pedir(perfilId, cfg, clave, 'inbounddocuments/search', 'buscar documentos recibidos', post(filtro)),
  contarRecibidos: (perfilId, cfg, clave, filtro) => pedir(perfilId, cfg, clave, 'inbounddocuments/count', 'contar documentos recibidos', post(filtro)),
  /** Metadatos y estado de un documento recibido. */
  recibido: (perfilId, cfg, clave, id) => pedir(perfilId, cfg, clave, ruta(id), 'consultar el documento recibido'),
  /** Archivo del documento recibido: pdf, ubl o attacheddocument (Saphety lo envía en base64). */
  archivoRecibido: (perfilId, cfg, clave, id, formato) => archivo(perfilId, cfg, clave, ruta(id, `/${formato}`)),
  adjuntosRecibido: (perfilId, cfg, clave, id) => pedir(perfilId, cfg, clave, ruta(id, '/attachments'), 'consultar los adjuntos'),
  adjuntoRecibido: (perfilId, cfg, clave, id, adjuntoId) => archivo(perfilId, cfg, clave, ruta(id, `/attachments/${encodeURIComponent(adjuntoId)}/content`)),
  respuestasRecibido: (perfilId, cfg, clave, id) => pedir(perfilId, cfg, clave, ruta(id, '/applicationresponses'), 'consultar las respuestas'),
  /** Pide a Saphety sincronizar los estados del documento con la DIAN. */
  sincronizarRecibido: (perfilId, cfg, clave, id) => pedir(perfilId, cfg, clave, ruta(id, '/syncallstatus'), 'sincronizar con la DIAN', post({})),

  // --- Eventos RADIAN (salen a la DIAN y al proveedor: no se pueden deshacer)
  /** 030 Acuse de recibo del documento. persona: { FirstName, FamilyName, JobTitle, OrganizationDepartment, Identification }. */
  acuseRecibo: (perfilId, cfg, clave, id, persona) => pedir(perfilId, cfg, clave, ruta(id, '/receive'), 'registrar el acuse de recibo', post(persona)),
  /** 032 Recibo del bien o prestación del servicio. */
  reciboBien: (perfilId, cfg, clave, id, persona) => pedir(perfilId, cfg, clave, ruta(id, '/goodsreceived'), 'registrar el recibo del bien o servicio', post(persona)),
  /** 033 Aceptación expresa. */
  aceptar: (perfilId, cfg, clave, id, motivo) => pedir(perfilId, cfg, clave, ruta(id, '/accept'), 'aceptar el documento', post({ Reason: motivo })),
  /** 031 Reclamo (rechazo) con su código de concepto (01-04). */
  rechazar: (perfilId, cfg, clave, id, motivo, codigo) => pedir(perfilId, cfg, clave, ruta(id, '/reject'), 'rechazar el documento', post({ Reason: motivo, ReasonCode: codigo })),
};
