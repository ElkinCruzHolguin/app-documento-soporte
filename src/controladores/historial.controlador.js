'use strict';
// Historial de envíos. Solo traduce HTTP <-> servicio.
function crearControladorHistorial({ historial }) {
  return {
    async listar(req, res) {
      res.json(await historial.listar(req.usuario, { buscar: req.query.buscar, limite: req.query.limite }));
    },
    async obtener(req, res) {
      res.json(await historial.obtener(req.usuario, req.params.id));
    },
  };
}

module.exports = { crearControladorHistorial };
