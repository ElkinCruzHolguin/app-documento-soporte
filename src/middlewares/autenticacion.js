'use strict';
// Exige sesión válida y deja el usuario en req.usuario. Si la sesión no sirve, borra la cookie.
const seguridad = require('../infraestructura/seguridad');
const { asincrono } = require('./asincrono');

function requiereSesion(autenticacion, { cookieSegura }) {
  return asincrono(async (req, res, next) => {
    try {
      req.usuario = await autenticacion.validarSesion(seguridad.leerCookie(req, seguridad.COOKIE));
    } catch (e) {
      res.set('Set-Cookie', seguridad.cookieSesion('', { segura: cookieSegura }));
      throw e;
    }
    next();
  });
}

module.exports = { requiereSesion };
