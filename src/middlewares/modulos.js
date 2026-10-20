'use strict';
// Exige que el usuario de la sesión tenga habilitado el módulo (ver src/dominio/modulos.js).
const { asincrono } = require('./asincrono');

const requiereModulo = (modulos, modulo) => asincrono(async (req, res, next) => {
  await modulos.exigir(req.usuario, modulo);
  next();
});

module.exports = { requiereModulo };
