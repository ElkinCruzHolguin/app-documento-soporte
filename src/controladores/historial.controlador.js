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
    async exportarAceptados(req, res) {
      const a = await historial.exportarAceptados(req.usuario, { buscar: req.query.buscar });
      res.set({
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${a.nombre.normalize('NFD').replace(/[^\x20-\x7e]/g, '')}"; filename*=UTF-8''${encodeURIComponent(a.nombre)}`,
        'Cache-Control': 'private, no-store',
      });
      res.send(a.contenido);
    },
  };
}

module.exports = { crearControladorHistorial };
