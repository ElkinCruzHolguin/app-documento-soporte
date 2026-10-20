'use strict';
// Inicio de sesión (contraseña y luego código al correo), cierre y estado del usuario conectado.
const seguridad = require('../infraestructura/seguridad');

function crearControladorSesion({ autenticacion, companias, modulos }, { cookieSegura }) {
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

    /** Catálogo de módulos (para Administración). */
    modulos(req, res) {
      res.json(modulos.catalogo());
    },

    /** El usuario de compañía cambia de compañía (p. ej. de QA a producción). */
    async cambiarCompania(req, res) {
      const { token } = await autenticacion.cambiarCompania(req.usuario, (req.body || {}).perfilId);
      res.set('Set-Cookie', seguridad.cookieSesion(token, { segura: cookieSegura })).json({ ok: true });
    },

    async estado(req, res) {
      const [p, mods, otras] = await Promise.all([companias.deActor(req.usuario), modulos.deActor(req.usuario), companias.disponibles(req.usuario)]);
      res.json({
        usuario: { usuario: req.usuario.usuario, rol: req.usuario.rol, login: autenticacion.activa, modulos: mods, cambiaClave: !!req.usuario.id, companias: otras },
        perfil: p && { id: p.id, nombre: p.nombre, modoEnvio: p.config.modoEnvio, url: p.config.url, numeracion: p.config.numeracion },
      });
    },
  };
}

module.exports = { crearControladorSesion };
