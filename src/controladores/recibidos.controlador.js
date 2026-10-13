'use strict';
// Buzón de recepción y eventos RADIAN. Solo traduce HTTP <-> servicio.
function crearControladorRecibidos({ recibidos }) {
  return {
    async listar(req, res) {
      const { desde, hasta, numero, proveedor, estado, pagina } = req.query;
      res.json(await recibidos.listar(req.usuario, { desde, hasta, numero, proveedor, estado, pagina }));
    },
    async obtener(req, res) {
      res.json(await recibidos.obtener(req.usuario, req.params.id));
    },
    async archivo(req, res) {
      const a = await recibidos.archivo(req.usuario, req.params.id, req.params.formato);
      const disposicion = req.query.descargar ? 'attachment' : 'inline';
      res.set({ 'Content-Type': a.tipo, 'Content-Disposition': `${disposicion}; filename="${a.nombre}"`, 'Cache-Control': 'private, no-store' });
      res.send(a.contenido);
    },
    async evento(req, res) {
      res.json(await recibidos.registrarEvento(req.usuario, req.params.id, req.body || {}));
    },
  };
}

module.exports = { crearControladorRecibidos };
