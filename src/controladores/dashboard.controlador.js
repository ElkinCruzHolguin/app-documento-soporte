'use strict';
// Tablero de la compañía. Solo traduce HTTP <-> servicio.
function crearControladorDashboard({ dashboard }) {
  return {
    async obtener(req, res) {
      res.json(await dashboard.obtener(req.usuario));
    },
  };
}

module.exports = { crearControladorDashboard };
