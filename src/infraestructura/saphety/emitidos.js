'use strict';
// Documentos emitidos (outbounddocuments): búsqueda, conteo, metadatos, estado, respuestas DIAN y archivos.
const { pedir, archivo, rutaDocumento } = require('./cliente');

const ruta = (id, extra) => rutaDocumento('outbounddocuments', id, extra);

module.exports = {
  /** Busca documentos emitidos con el filtro ya armado (ResultData: { Items, Total } o lista). */
  buscarEmitidos: (perfilId, cfg, clave, filtro) =>
    pedir(perfilId, cfg, clave, 'outbounddocuments/search', 'buscar documentos', { metodo: 'POST', cuerpo: filtro }),
  /** Cuenta los documentos emitidos que cumplen el filtro. */
  contarEmitidos: (perfilId, cfg, clave, filtro) =>
    pedir(perfilId, cfg, clave, 'outbounddocuments/count', 'contar documentos', { metodo: 'POST', cuerpo: filtro }),
  /** Metadatos de un documento emitido (número, partes, estado, valor, CUDS). */
  emitido: (perfilId, cfg, clave, id) => pedir(perfilId, cfg, clave, ruta(id), 'consultar el documento'),
  /** Estado actual del documento y, si los hay, los errores de validación. */
  estadoEmitido: (perfilId, cfg, clave, id) => pedir(perfilId, cfg, clave, ruta(id, '/status'), 'consultar el estado'),
  /** Respuestas (ApplicationResponse) de la DIAN y del adquiriente. */
  respuestasEmitido: (perfilId, cfg, clave, id) => pedir(perfilId, cfg, clave, ruta(id, '/applicationresponses'), 'consultar las respuestas de la DIAN'),
  /** Archivo del documento: pdf, ubl, attacheddocument o dto. */
  archivoEmitido: (perfilId, cfg, clave, id, formato) => archivo(perfilId, cfg, clave, ruta(id, `/${formato}/content`)),
  /** Ids de los adjuntos del documento. */
  adjuntosEmitido: (perfilId, cfg, clave, id) => pedir(perfilId, cfg, clave, ruta(id, '/attachments'), 'consultar los adjuntos'),
  /** Contenido de un adjunto. */
  adjuntoEmitido: (perfilId, cfg, clave, id, adjuntoId) => archivo(perfilId, cfg, clave, ruta(id, `/attachments/${encodeURIComponent(adjuntoId)}`)),
  /** Registra la aceptación tácita de una factura emitida. */
  aceptacionTacita: (perfilId, cfg, clave, id) => pedir(perfilId, cfg, clave, ruta(id, '/tacitlyaccept'), 'registrar la aceptación tácita', { metodo: 'POST', cuerpo: {} }),
};
