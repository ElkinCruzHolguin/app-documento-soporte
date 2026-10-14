'use strict';
// Notas de ajuste al documento soporte. Solo traduce HTTP <-> servicio.
function crearControladorNotasAjuste({ notasAjuste }) {
  return {
    async preparar(req, res) {
      res.json(await notasAjuste.preparar(req.usuario, req.params.id));
    },
    async enviar(req, res) {
      res.json(await notasAjuste.enviar(req.usuario, req.params.id, req.body || {}));
    },
  };
}

module.exports = { crearControladorNotasAjuste };
