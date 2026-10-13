'use strict';
// Documentos emitidos consultados en Saphety. Solo traduce HTTP <-> servicio.
function crearControladorEmitidos({ emitidos }) {
  return {
    async listar(req, res) {
      const { desde, hasta, numero, pagina } = req.query;
      res.json(await emitidos.listar(req.usuario, { desde, hasta, numero, pagina }));
    },
    async obtener(req, res) {
      res.json(await emitidos.obtener(req.usuario, req.params.id));
    },
    async archivo(req, res) {
      const a = await emitidos.archivo(req.usuario, req.params.id, req.params.formato);
      // inline para verlo en la página (PDF); con ?descargar=1 se descarga.
      const disposicion = req.query.descargar ? 'attachment' : 'inline';
      res.set({ 'Content-Type': a.tipo, 'Content-Disposition': `${disposicion}; filename="${a.nombre}"`, 'Cache-Control': 'private, no-store' });
      res.send(a.contenido);
    },
  };
}

module.exports = { crearControladorEmitidos };
