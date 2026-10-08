'use strict';
// Conversión del Excel y envío de documentos. Solo traduce HTTP <-> servicio.
function crearControladorDocumentos({ documentos }) {
  return {
    async convertir(req, res) {
      res.json(await documentos.convertir(req.usuario, req.body));
    },
    async enviar(req, res) {
      res.json(await documentos.enviar(req.usuario, req.body || {}));
    },
  };
}

module.exports = { crearControladorDocumentos };
