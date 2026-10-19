'use strict';
// Cuenta del usuario conectado. Solo traduce HTTP <-> servicio.
function crearControladorCuenta({ cuenta }) {
  return {
    async cambiarClave(req, res) {
      const { actual, nueva } = req.body || {};
      await cuenta.cambiarClave(req.usuario, { actual, nueva });
      res.json({ ok: true });
    },
  };
}

module.exports = { crearControladorCuenta };
