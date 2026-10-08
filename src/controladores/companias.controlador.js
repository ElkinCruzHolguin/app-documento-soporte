'use strict';
// Compañías (rutas /api/perfiles). Solo traduce HTTP <-> servicio.
function crearControladorCompanias({ companias }) {
  return {
    async listar(req, res) {
      res.json(await companias.listar(req.usuario));
    },
    async crear(req, res) {
      res.json(await companias.crear(req.usuario, req.body || {}));
    },
    async actualizar(req, res) {
      res.json(await companias.actualizar(req.usuario, req.params.id, req.body || {}));
    },
    async activar(req, res) {
      await companias.activar(req.usuario, req.params.id);
      res.json({ ok: true });
    },
    async eliminar(req, res) {
      await companias.eliminar(req.usuario, req.params.id);
      res.json({ ok: true });
    },
    async probar(req, res) {
      res.json({ ok: true, mensaje: await companias.probarConexion(req.usuario, req.params.id) });
    },
    async catalogo(req, res) {
      res.json(await companias.catalogo(req.usuario, req.params.id, req.params.nombre));
    },
  };
}

module.exports = { crearControladorCompanias };
