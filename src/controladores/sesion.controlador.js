'use strict';
// Inicio de sesión (contraseña o código al correo), cierre y estado del usuario conectado.
const seguridad = require('../infraestructura/seguridad');

function crearControladorSesion({ autenticacion, companias }, { cookieSegura }) {
  return {
    async iniciar(req, res) {
      const { usuario, clave } = req.body || {};
      const { token, rol } = await autenticacion.iniciarSesion({ usuario, clave, ip: req.ip });
      if (token) res.set('Set-Cookie', seguridad.cookieSesion(token, { segura: cookieSegura }));
      res.json({ ok: true, rol });
    },

    opciones(req, res) {
      res.json(autenticacion.opciones());
    },

    async solicitarCodigo(req, res) {
      const { correo } = req.body || {};
      res.json({ ok: true, ...(await autenticacion.solicitarCodigo({ correo, ip: req.ip })) });
    },

    async verificarCodigo(req, res) {
      const { correo, codigo } = req.body || {};
      const { token, rol } = await autenticacion.verificarCodigo({ correo, codigo, ip: req.ip });
      res.set('Set-Cookie', seguridad.cookieSesion(token, { segura: cookieSegura }));
      res.json({ ok: true, rol });
    },

    cerrar(req, res) {
      res.set('Set-Cookie', seguridad.cookieSesion('', { segura: cookieSegura })).json({ ok: true });
    },

    async estado(req, res) {
      const p = await companias.deActor(req.usuario);
      res.json({
        usuario: { usuario: req.usuario.usuario, rol: req.usuario.rol, login: autenticacion.activa },
        perfil: p && { id: p.id, nombre: p.nombre, modoEnvio: p.config.modoEnvio, url: p.config.url, numeracion: p.config.numeracion },
      });
    },
  };
}

module.exports = { crearControladorSesion };
