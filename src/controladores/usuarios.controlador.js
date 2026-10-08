'use strict';
// Usuarios de las compañías. Solo traduce HTTP <-> servicio.
function crearControladorUsuarios({ usuarios }) {
  return {
    async listar(req, res) {
      res.json(await usuarios.listar(req.usuario));
    },
    async crear(req, res) {
      res.json(await usuarios.crear(req.usuario, req.body || {}));
    },
    async actualizar(req, res) {
      res.json(await usuarios.actualizar(req.usuario, req.params.id, req.body || {}));
    },
    async eliminar(req, res) {
      await usuarios.eliminar(req.usuario, req.params.id);
      res.json({ ok: true });
    },
  };
}

module.exports = { crearControladorUsuarios };
