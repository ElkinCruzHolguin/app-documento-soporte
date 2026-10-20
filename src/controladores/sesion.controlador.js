'use strict';
// Inicio de sesión (contraseña y luego código al correo), cierre y estado del usuario conectado.
const seguridad = require('../infraestructura/seguridad');

function crearControladorSesion({ autenticacion, companias }, { cookieSegura }) {
  return {
    async iniciar(req, res) {
      const { usuario, clave } = req.body || {};
      const r = await autenticacion.iniciarSesion({ usuario, clave, ip: req.ip });
      if (r.pendiente) {
        // Contraseña correcta: falta el código que se envió al correo.
        res.set('Set-Cookie', seguridad.cookiePendiente(r.pendiente, { segura: cookieSegura }));
        return res.json({ ok: true, paso: 'codigo', destino: r.destino });
      }
      if (r.token) res.set('Set-Cookie', seguridad.cookieSesion(r.token, { segura: cookieSegura }));
      res.json({ ok: true, rol: r.rol });
    },

    async verificarCodigo(req, res) {
      const pendiente = seguridad.leerCookie(req, seguridad.COOKIE_PENDIENTE);
      const { token, rol } = await autenticacion.verificarCodigo({ pendiente, codigo: (req.body || {}).codigo, ip: req.ip });
      res.set('Set-Cookie', [
        seguridad.cookieSesion(token, { segura: cookieSegura }),
        seguridad.cookiePendiente('', { segura: cookieSegura }),
      ]);
      res.json({ ok: true, rol });
    },

    async reenviarCodigo(req, res) {
      const pendiente = seguridad.leerCookie(req, seguridad.COOKIE_PENDIENTE);
      res.json({ ok: true, ...(await autenticacion.reenviarCodigo({ pendiente, ip: req.ip })) });
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
